import { NestFactory } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { createSwaggerDocument } from '../src/swagger/swagger.config';

async function exportOpenApi() {
  console.log('Generating OpenAPI specification...');
  const app = await NestFactory.create(AppModule, { logger: false });

  const document = createSwaggerDocument(app);
  const rootDir = path.resolve(__dirname, '..');
  const openApiPath = path.join(rootDir, 'openapi.json');

  fs.writeFileSync(openApiPath, JSON.stringify(document, null, 2), 'utf-8');
  console.log(`✓ OpenAPI specification exported to ${openApiPath}`);

  // Generate Postman Collection v2.1
  console.log('Generating Postman Collection and Environment...');
  const postmanCollection = convertOpenApiToPostman(document);
  const postmanPath = path.join(rootDir, 'postman_collection.json');
  fs.writeFileSync(postmanPath, JSON.stringify(postmanCollection, null, 2), 'utf-8');
  console.log(`✓ Postman collection exported to ${postmanPath}`);

  // Generate Postman Environment
  const postmanEnv = {
    id: 'lms-environment',
    name: 'LMS Environment (Local)',
    values: [
      {
        key: 'baseUrl',
        value: 'http://localhost:3000',
        type: 'default',
        enabled: true,
      },
      {
        key: 'accessToken',
        value: '',
        type: 'secret',
        enabled: true,
      },
    ],
    _postman_variable_scope: 'environment',
  };
  const envPath = path.join(rootDir, 'lms.postman_environment.json');
  fs.writeFileSync(envPath, JSON.stringify(postmanEnv, null, 2), 'utf-8');
  console.log(`✓ Postman environment exported to ${envPath}`);

  await app.close();
  process.exit(0);
}

function convertOpenApiToPostman(openApi: any) {
  const foldersMap = new Map<string, any[]>();

  for (const [endpointPath, pathItem] of Object.entries<any>(openApi.paths || {})) {
    for (const [method, operation] of Object.entries<any>(pathItem)) {
      if (['get', 'post', 'put', 'patch', 'delete'].indexOf(method.toLowerCase()) === -1) {
        continue;
      }

      const tag = operation.tags?.[0] || 'General';
      const items = foldersMap.get(tag) || [];

      // Convert path params: /users/{id} -> /users/:id
      const postmanUrlPath = endpointPath
        .split('/')
        .filter(Boolean)
        .map((segment) => (segment.startsWith('{') && segment.endsWith('}') ? `:${segment.slice(1, -1)}` : segment));

      const pathVariables: any[] = [];
      for (const param of operation.parameters || []) {
        if (param.in === 'path') {
          pathVariables.push({
            key: param.name,
            value: param.schema?.example || param.example || '',
            description: param.description || '',
          });
        }
      }

      const queryParams: any[] = [];
      for (const param of operation.parameters || []) {
        if (param.in === 'query') {
          queryParams.push({
            key: param.name,
            value: param.schema?.example || param.example || '',
            description: param.description || '',
            disabled: !param.required,
          });
        }
      }

      const headers: any[] = [
        {
          key: 'Content-Type',
          value: 'application/json',
          type: 'text',
        },
      ];

      // Auth header
      const auth =
        endpointPath.startsWith('/auth/login') ||
        endpointPath === '/health' ||
        endpointPath === '/health/ready'
          ? undefined
          : {
              type: 'bearer',
              bearer: [
                {
                  key: 'token',
                  value: '{{accessToken}}',
                  type: 'string',
                },
              ],
            };

      let body: any = undefined;
      const requestBody = operation.requestBody?.content?.['application/json'];
      if (requestBody) {
        body = {
          mode: 'raw',
          raw: requestBody.schema?.example ? JSON.stringify(requestBody.schema.example, null, 2) : '{}',
          options: {
            raw: {
              language: 'json',
            },
          },
        };
      }

      // Add auto-save accessToken test script for /auth/login
      const events: any[] = [];
      if (endpointPath === '/auth/login' && method.toLowerCase() === 'post') {
        events.push({
          listen: 'test',
          script: {
            exec: [
              'if (pm.response.code === 200) {',
              '    var jsonData = pm.response.json();',
              '    if (jsonData.accessToken) {',
              '        pm.environment.set("accessToken", jsonData.accessToken);',
              '        console.log("accessToken successfully saved to environment!");',
              '    }',
              '}',
            ],
            type: 'text/javascript',
          },
        });
      }

      items.push({
        name: operation.summary || `${method.toUpperCase()} ${endpointPath}`,
        event: events.length > 0 ? events : undefined,
        request: {
          auth,
          method: method.toUpperCase(),
          header: headers,
          body,
          url: {
            raw: `{{baseUrl}}${endpointPath}`,
            host: ['{{baseUrl}}'],
            path: postmanUrlPath,
            variable: pathVariables.length > 0 ? pathVariables : undefined,
            query: queryParams.length > 0 ? queryParams : undefined,
          },
          description: operation.description || '',
        },
        response: [],
      });

      foldersMap.set(tag, items);
    }
  }

  const postmanItems: any[] = [];
  for (const [folderName, requests] of foldersMap.entries()) {
    postmanItems.push({
      name: folderName,
      item: requests,
    });
  }

  return {
    info: {
      _postman_id: 'lms-backend-collection',
      name: 'Leave Management System API',
      description: openApi.info?.description || 'Multi-tenant LMS API Postman Collection',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: postmanItems,
  };
}

exportOpenApi().catch((err) => {
  console.error('Failed to export OpenAPI:', err);
  process.exit(1);
});
