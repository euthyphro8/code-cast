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
      return executeDefaultStrategy(
        listener.repository,
        listener.branch,
        listener.dist,
        config.reposDirectory,
        config.serveDirectory
      );
    }
    return reply.status(501).send();
  });
};

const executeDefaultStrategy = async (
  repoName: string,
  branch: string,
  dist: string,
  repoDir: string,
  serveDir: string
) => {
  console.log(
    `${COLORS.BgWhite}${COLORS.FgBlue}Initiating default strategy...${COLORS.Reset}`
  );

  console.log(`${COLORS.BgBlue}Verifying correct branch...${COLORS.Reset}`);
  const { stdout: branchOut, stderr: branchError } = await exec(
    `git rev-parse --abbrev-ref HEAD`,
    { cwd: `${repoDir}/${repoName}` }
  ).catch((r) => r);
  if (branchOut.trim().toLowerCase() !== branch.trim().toLowerCase()) {
    console.log('Branch mismatch, skipping update');
    console.log(`Receieved: ${branchOut}. Expected: ${branch}`);
    if (branchError) {
      console.log(branchError);
    }
    throw new Error('Branch mismatch, server may be misconfigured');
  }
  console.log('Branch matched:', branchOut);

  console.log(`${COLORS.BgBlue}Pulling from remote...${COLORS.Reset}`);
  const { stdout: pullOut, stderr: pullError } = await exec(`git pull`, {
    cwd: `${repoDir}/${repoName}`,
  }).catch((r) => r);
  if (pullError) {
    console.error(
      'Error pulling from remote:\n',
      COLORS.BgRed,
      pullError,
      COLORS.Reset
    );
    throw new Error('Error pulling from remote, server may be misconfigured');
  }
  console.log('Pulled from remote:\n', pullOut);

  console.log(`${COLORS.BgBlue}Resolving deps...${COLORS.Reset}`);
  const {
    stdout: installOut,
    stderr: installError,
    exitCode: installExitCode,
  } = await exec(`npm run install`, {
    cwd: `${repoDir}/${repoName}`,
  }).catch((r) => r);
  if (installError && installExitCode !== 0) {
    console.error(
      'Error installing deps:\n',
      COLORS.BgRed,
      installError,
      COLORS.Reset
    );
    throw new Error('Error installing deps, server may be misconfigured');
  }
  if (installOut) {
    console.log('Install output:\n', installOut);
  }

  console.log(`${COLORS.BgBlue}Building application...${COLORS.Reset}`);
  const {
    stdout: buildOut,
    stderr: buildError,
    exitCode: buildExitCode,
  } = await exec(`npm run build`, {
    cwd: `${repoDir}/${repoName}`,
  }).catch((r) => r);
  if (buildError && buildExitCode !== 0) {
    console.error(
      'Error building application:\n',
      COLORS.BgRed,
      buildError,
      COLORS.Reset
    );
    throw new Error('Error building application, server may be misconfigured');
  }
  if (buildOut) {
    console.log('Build output:\n', buildOut);
  }

  console.log(`${COLORS.BgBlue}Moving files to dist...${COLORS.Reset}`);
  const { stdout: mvOut, stderr: mvError } = await exec(
    `mv ${repoDir}/${repoName}/${dist}/* ${serveDir}/${repoName}`
  ).catch((r) => r);
  if (mvOut) {
    console.log('Moved files:', mvOut);
  }
  if (mvError) {
    console.error('Error moving files:', mvError);
    throw new Error('Error moving files, server may be misconfigured');
  }

  console.log(
    `${COLORS.FgGreen}${COLORS.BgWhite}Default strategy successfull!${COLORS.Reset}`
  );
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

const COLORS = {
  Reset: '\x1b[0m',
  Bright: '\x1b[1m',
  Dim: '\x1b[2m',
  Underscore: '\x1b[4m',
  Blink: '\x1b[5m',
  Reverse: '\x1b[7m',
  Hidden: '\x1b[8m',
  FgBlack: '\x1b[30m',
  FgRed: '\x1b[31m',
  FgGreen: '\x1b[32m',
  FgYellow: '\x1b[33m',
  FgBlue: '\x1b[34m',
  FgMagenta: '\x1b[35m',
  FgCyan: '\x1b[36m',
  FgWhite: '\x1b[37m',
  FgGray: '\x1b[90m',
  BgBlack: '\x1b[40m',
  BgRed: '\x1b[41m',
  BgGreen: '\x1b[42m',
  BgYellow: '\x1b[43m',
  BgBlue: '\x1b[44m',
  BgMagenta: '\x1b[45m',
  BgCyan: '\x1b[46m',
  BgWhite: '\x1b[47m',
  BgGray: '\x1b[100m',
};

export default app;
export { app };
