import { Actor } from 'apify';
import { log, RequestList, BasicCrawler, sleep } from 'crawlee';

import { getRunsForActorOrTask } from './get-runs.js';

interface Input {
    runIds: string[],
    actorOrTaskId: string | undefined,
    dateFrom: string | undefined,
    dateTo: string | undefined,
    resurrectRuns: boolean,
    resurrectRunsConcurrency: number,
    resurrectBuildName: string | undefined,
    token: string | undefined,
}

Actor.main(async () => {
    const input = await Actor.getInput() as Input;

    const {
        runIds = [],
        actorOrTaskId,
        dateFrom,
        dateTo,
        resurrectRuns = false,
        resurrectRunsConcurrency = 1,
        resurrectBuildName,
        // Just for local usage
        token,
    } = input;

    const clientOptions = token ? { token } : {};
    const client = Actor.newClient(clientOptions);

    if (actorOrTaskId) {
        const runs = await getRunsForActorOrTask({ actorOrTaskId, dateFrom, dateTo, client });
        runIds.push(...runs.map(({ id }) => id));
    }

    const runsSources = runIds.map(( runId ) => ({
        url: 'http://example.com',
        uniqueKey: runId,
        label: 'RUN_ID',
    }));

    const runsStats = (await Actor.getValue('RUNS_STATS') || {}) as { [runId: string]: { loaded: number, rebirth: number } };
    Actor.on('persistState', async () => {
        await Actor.setValue('RUNS_STATS', runsStats);
    })

    const crawler = new BasicCrawler({
        maxConcurrency: 5,
        requestHandlerTimeoutSecs: 999999,
        requestHandler: async (context) => {
            const { label } = context.request;
            if (label === 'RUN_ID') {
                const runId = context.request.uniqueKey;
                const run = await client.run(runId).get();
                // Missing type in client
                const { defaultRequestQueueId } = run as any as { defaultRequestQueueId: string };
                await crawler.addRequests([{
                    url: 'http://example.com',
                    uniqueKey: defaultRequestQueueId,
                    label: 'LIST_QUEUE',
                    userData: { runId, requestQueueId: defaultRequestQueueId },
                }]);
            } else if (label === 'LIST_QUEUE') {
                // exclusiveStartId is empty on the first request
                const { runId, requestQueueId, exclusiveStartId, page = 1 } = context.request.userData;
                if (!runsStats[runId]) {
                    runsStats[runId] = { loaded: 0, rebirth: 0 };
                }

                const { items } = await client.requestQueue(requestQueueId).listRequests({ exclusiveStartId, limit: 1000 });
                // This seem to be the only quite reliable way to find out failed requests
                const failedRequests = items.filter((request) => (request.errorMessages?.length || 0) > (request.retryCount || 0));
                log.info(`[RUN: ${runId}][PAGE: ${page}]: Loaded ${items.length} requests, ${failedRequests.length} of those were failed, rebirthing them. `
                    + `Failed/Total: ${runsStats[runId].rebirth + failedRequests.length}/${runsStats[runId].loaded + items.length}.`);

                if (items.length === 0) {
                    log.info(`[RUN: ${runId}][PAGE: ${page}]: No more requests in the queue ${requestQueueId}`);
                    return;
                }

                // we could enqueue the request updates but this should be very fast so let's try it here
                for (let request of failedRequests) {
                    request.retryCount = 0;
                    request.errorMessages = [];
                    // @ts-ignore
                    request.handledAt = null;
                    await client.requestQueue(requestQueueId).updateRequest(request)
                }
                log.info(`[RUN: ${runId}][PAGE: ${page}]: Rebirthed ${failedRequests.length} requests`);

                runsStats[runId].loaded += items.length;
                runsStats[runId].rebirth += failedRequests.length;

                // Paginate to the next batch
                await crawler.addRequests([{
                    url: 'http://example.com',
                    uniqueKey: `${requestQueueId}${exclusiveStartId}`,
                    label: 'LIST_QUEUE',
                    userData: {
                        runId,
                        requestQueueId,
                        exclusiveStartId: items[items.length - 1].id,
                        page: page + 1,
                    },
                }])
            }
        },
    });

    await crawler.addRequests(runsSources)

    log.info(`Rebirthing requests starting`);

    await crawler.run();

    log.info(`Rebirthing requests finished`);

    const runsToResurrect = Object.keys(runsStats).filter((runId) => runsStats[runId].rebirth > 0);

    if (resurrectRuns && runsToResurrect.length > 0) {
        log.info(`${runsToResurrect.length} runs with rebirth requests to be resurrected`);
        const resurrectSources = runsToResurrect.map((runId) => ({
            url: 'https://example.com',
            uniqueKey: runId,
        }));
        const resurrectRequestList = await RequestList.open('RESURRECT-LIST', resurrectSources);

        const resurrectCrawler = new BasicCrawler({
            maxConcurrency: resurrectRunsConcurrency,
            requestList: resurrectRequestList,
            // We wait infinitely
            requestHandlerTimeoutSecs: 999999,
            requestHandler: async ({ request }) => {
                const runId = request.uniqueKey;
                const runClient = client.run(runId);
                // We check if the run is still running,
                // if it was already resurrected and finished, this request got handled
                // and will not be invoked again
                const { status } = (await runClient.get())!;
                if (!['RUNNING', 'READY'].includes(status)) {
                    log.info(`Ressurecting run: ${runId}`);
                    await runClient.resurrect({ build: resurrectBuildName });
                } else {
                    log.info(`Run is already running, waiting for finish: ${runId}`);
                }
                await sleep(2000);
                await runClient.waitForFinish();
                log.info(`Run finished: ${runId}`);
            },
        });

        log.info(`Starting resurrecting runs`);
        await resurrectCrawler.run();
        log.info(`Finished resurrecting runs`);
    }
});
