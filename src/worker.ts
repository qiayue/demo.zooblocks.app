import type { Env } from './types';
import { handle } from './router';

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      return await handle(req, env);
    } catch (err) {
      console.error(err);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
