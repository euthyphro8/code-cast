import 'dotenv/config';
import { promisify } from 'node:util';
import child_process from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FastifyPluginAsync, FastifyReply } from 'fastify';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import { PushEventPayload, UpdateConfig, UpdateListener } from './types';

const exec = promisify(child_process.exec);

const app: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.register(sensible);
  fastify.register(rateLimit, { max: 2, timeWindow: '1 minute' });
  fastify.all('*', async function (request, reply) {
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
    const payload = request.body as PushEventPayload;
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
    if (!filter(listener, payload)) {
      return forbidden(reply);
    }
    console.log('All filters passed, updating application:');
    if (listener.strategy.type === 'default') {
      console.log('Using default strategy');
      return executeDefaultStrategy(listener.branch!, listener.dist);
    }
    return reply.status(501).send();
  });
};

const executeDefaultStrategy = async (
  branch: string,
  distConfig: { in: string; out: string }
) => {
  const { stderr: cdError } = await exec(`cd ${distConfig.in}/..`);
  if (cdError) {
    console.error('Error changing directory:', cdError);
    throw new Error('Error changing directory, server may be misconfigured');
  }
  const { stdout: branchOut } = await exec(`git rev-parse --abbrev-ref HEAD`);
  if (branchOut.trim().toLowerCase() !== branch.trim().toLowerCase()) {
    console.log('Branch mismatch, skipping update');
    console.log(`Receieved: ${branchOut}. Expected: ${branch}`);
    throw new Error('Branch mismatch, server may be misconfigured');
  }
  const { stderr: pullError } = await exec(`git pull`);
  if (pullError) {
    console.error('Error pulling from remote:', pullError);
    throw new Error('Error pulling from remote, server may be misconfigured');
  }
  const { stderr: buildError } = await exec(`npm run build`);
  if (buildError) {
    console.error('Error building application:', buildError);
    throw new Error('Error building application, server may be misconfigured');
  }
  const { stderr: mvError } = await exec(
    `mv ${distConfig.in}/* ${distConfig.out}`
  );
  if (mvError) {
    console.error('Error moving files:', mvError);
    throw new Error('Error moving files, server may be misconfigured');
  }
};

const filter = (listener: UpdateListener, payload: PushEventPayload) => {
  console.log('Found eligible repo for update', listener);
  if (listener.filters) {
    const { username, email, name } = listener.filters;
    if (
      (username && username !== payload.pusher?.username) ||
      (email && email !== payload.pusher?.email) ||
      (name && name !== payload.pusher?.name)
    ) {
      console.log('Pusher is not allowed:', payload.pusher);
      return false;
    }
  }
  if (!listener.branch || listener.branch !== payload.ref?.split('/').pop()) {
    console.log('Branch is not allowed:', payload.ref);
    return false;
  }
  if (
    listener.commitFlag &&
    !payload.commits?.some((commit) =>
      commit.message.includes(listener.commitFlag as string)
    )
  ) {
    console.log('Commit flag not found:', listener.commitFlag);
    return false;
  }
  return true;
};

const retrieveConfig = () => {
  try {
    const dir = process.env.CC_CONFIG_DIR ?? '/etc/code-cast';
    const path = join(dir, 'config.json');
    console.log('Reading configuration from:', path);
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
    .status(403)
    .send(
      `<html lang="en"><div id="app"><div>403</div><div class="txt">Forbidden<span class="blink">_</span></div></div><style>@import url(https://fonts.googleapis.com/css?family=Press+Start+2P);body,html{width:100%;height:100%;margin:0}*{font-family:"Press Start 2P",cursive;box-sizing:border-box}#app{padding:1rem;background:#000;display:flex;height:100%;justify-content:center;align-items:center;color:#54fe55;text-shadow:0 0 10px;font-size:6rem;flex-direction:column}#app .txt{font-size:1.8rem}@keyframes blink{0%{opacity:0}49%{opacity:0}50%{opacity:1}100%{opacity:1}}.blink{animation-name:blink;animation-duration:1s;animation-iteration-count:infinite}</style></html>`
    );
};

export default app;
export { app };
