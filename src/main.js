const Apify = require('apify');

const { log } = Apify.utils;

Apify.main(async () => {
    const input = await Apify.getInput();

    const client = Apify.newClient();

    // TODO: Add option for auto resurrect
    const {
        runIds = [],
        actorOrTaskId,
        dateFrom,
        dateTo,
        retryCount,
        resurrectRuns,
        resurrectRunsConcurrency = 1,
    } = input;

    // Log scanner does some of the work of finding the right runs of actors
    // And gives us metadata about each log line containing specified retryCount
    // If the log has non-standard format, it might not find the requests
    // Also some logs get trimmed when too large
    const regexes = ['Request failed and reached maximum retries'];
    if (typeof retryCount === 'number') {
        regexes.push(`"retryCount":${retryCount}`);
    }

    log.info(`Calling lukaskrivka/log-scanner actor to find request IDs in run logs`);
    const { defaultDatasetId } = await Apify.call(
        'lukaskrivka/log-scanner',
        {
            runIdsOrUrls: runIds,
            actorOrTaskId,
            dateFrom,
            dateTo,
            regexes,
        },
    );

    const { items } = await client.dataset(defaultDatasetId).listItems();

    log.info(`Found ${items.length} log lines of requests`);

    const requestIds = items
        .map(({ lineText, runId }) => {
            // Looking for "id":"m1RDOEfwAIHe0tl"
            const match = lineText.match(/"id":"(\w+)"/);
            if (match) {
                return {
                    requestId: match[1],
                    runId,
                };
            }
        })
        .filter((id) => !!id);

    log.info(`Found ${requestIds.length} request IDs in those log lines`);
    await Apify.setValue('REQUEST-IDS', requestIds);

    const sources = requestIds.map(({ requestId, runId }) => ({
        url: 'http://example.com',
        uniqueKey: requestId,
        userData: { requestId, runId },
    }));
    const requestList = await Apify.openRequestList('LIST', sources);

    // Just keeping queue IDs around to save few calls
    const runToQueueCache = {};

    const crawler = new Apify.BasicCrawler({
        requestList,
        maxConcurrency: 5,
        handleRequestFunction: async ({ request }) => {
            const { requestId, runId } = request.userData;
            let queueId = runToQueueCache[runId];
            if (!queueId) {
                const { defaultRequestQueueId } = await client.run(runId).get();
                queueId = defaultRequestQueueId;
                runToQueueCache[runId] = queueId;
            }

            const queueClient = client.requestQueue(queueId);
            const reqFromQueue = await queueClient.getRequest(requestId);
            const oldHandled = reqFromQueue.handledAt;
            const oldRetries = reqFromQueue.retryCount;
            reqFromQueue.handledAt = null;
            reqFromQueue.retryCount = 0;
            log.info(`Rebirthing request: ${request.userData.id}: `
                + `handled: ${oldHandled}, retries: ${oldRetries} => handled: null, retries: 0`);
            await queueClient.updateRequest(reqFromQueue);
        },
    });

    log.info(`Rebirthing requests starting`);

    await crawler.run();

    log.info(`Rebirthing requests finished`);

    if (resurrectRuns) {
        const runsToResurrect = Object.keys(runToQueueCache);
        log.info(`${runsToResurrect.length} runs with rebirth requests to be resurrected`);
        const resurrectSources = runsToResurrect.map((runId) => ({
            url: 'https://example.com',
            uniqueKey: runId,
        }));
        const resurrectRequestList = await Apify.openRequestList('RESURRECT-LIST', resurrectSources);

        const resurrectCrawler = new Apify.BasicCrawler({
            maxConcurrency: resurrectRunsConcurrency,
            requestList: resurrectRequestList,
            handleRequestFunction: async ({ request }) => {
                const runId = request.uniqueKey;
                const runClient = client.run(runId);
                // We check if the run is still running,
                // if it was already resurrected and finished, this request got handled
                // and will not be invoked again
                const { status } = await runClient.get();
                if (!['RUNNING', 'READY'].includes(status)) {
                    log.info(`Ressurecting run: ${runId}`);
                    await runClient.resurrect();
                } else {
                    log.info(`Run is already running, waiting for finish: ${runId}`);
                }
                await Apify.utils.sleep(2000);
                await runClient.waitForFinish();
                log.info(`Run finished: ${runId}`);
            },
        });

        log.info(`Starting resurrecting runs`);
        await resurrectCrawler.run();
        log.info(`Finished resurrecting runs`);
    }
});
