import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    validatedUserId?: string;
    adminUserId?: string;
  }
}
