import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FastifyPluginAsync, FastifyReply } from 'fastify';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import { PushEventPayload, UpdateConfig, UpdateListener } from './types';

const app: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.register(sensible);
  fastify.register(rateLimit, { max: 2, timeWindow: '1 minute' });
  fastify.all('/', async function (request, reply) {
    const requiredAgent = process.env.CC_AGENT ?? 'GitHub-Hookshot/';
    const agent = request.headers['user-agent'];
    const allowedEvents = ['ping', 'push'];
    const eventHeader = process.env.CC_EVENT_HEADER ?? 'x-github-event';
    const event = request.headers[eventHeader] as string;
    const method = request.method;
    if (
      method !== 'POST' ||
      !agent?.startsWith(requiredAgent) ||
      !allowedEvents.includes(event)
    ) {
      return forbidden(reply);
    }
    const config = retrieveConfig() as UpdateConfig;
    if (event === 'ping') {
      return reply.status(200).send();
    }
    const payload = (request.body as PushEventPayload) ?? {};
    if (!payload.repository?.name) {
      console.error('Repository name is missing in the payload.', payload);
      return reply.status(400).send();
    }
    const listener = config?.listeners?.find(
      (l) => l.repository === payload.repository.name
    );
    if (!listener) {
      console.error(
        'Application is not configured to accept this webhook.',
        config
      );
      return reply.status(400).send();
    }
    return update(listener, payload);
  });
};

const update = (listener: UpdateListener, payload: PushEventPayload) => {
  console.log('Updating application:', listener, payload);
};

const retrieveConfig = () => {
  try {
    const dir = process.env.CC_CONFIG_DIR ?? '/etc/code-cast';
    const path = join(dir, 'config.json');
    const file = readFileSync(path, 'utf-8');
    return JSON.parse(file);
  } catch (error) {
    console.error(error);
    throw new Error('Application is not configured.');
  }
};

const forbidden = (reply: FastifyReply) => {
  return reply
    .type('text/html')
    .send(
      `<div id="app"><div>403</div><div class="txt">Forbidden<span class="blink">_</span></div></div><style>@import url(https://fonts.googleapis.com/css?family=Press+Start+2P);body,html{width:100%;height:100%;margin:0}*{font-family:"Press Start 2P",cursive;box-sizing:border-box}#app{padding:1rem;background:#000;display:flex;height:100%;justify-content:center;align-items:center;color:#54fe55;text-shadow:0 0 10px;font-size:6rem;flex-direction:column}#app .txt{font-size:1.8rem}@keyframes blink{0%{opacity:0}49%{opacity:0}50%{opacity:1}100%{opacity:1}}.blink{animation-name:blink;animation-duration:1s;animation-iteration-count:infinite}</style>`
    );
};

export default app;
export { app, options };
