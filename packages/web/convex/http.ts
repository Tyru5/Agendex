import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';
import { sync, refresh } from './cli';

const http = httpRouter();

authComponent.registerRoutes(http, createAuth, { cors: true });

http.route({ path: '/api/cli/sync', method: 'POST', handler: sync });
http.route({ path: '/api/cli/refresh', method: 'POST', handler: refresh });

export default http;
