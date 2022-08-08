import { Actor } from 'apify';
import { log } from 'crawlee';
import { ActorRun, ApifyClient } from 'apify-client';

interface getRunsForActorOrTaskInput {
    actorOrTaskId: string,
    dateFrom: string| undefined,
    dateTo: string | undefined,
    client: ApifyClient,
}

export const getRunsForActorOrTask = async ({ actorOrTaskId, dateFrom, dateTo, client } : getRunsForActorOrTaskInput) => {
    // Test if the provided ID is actor or task or crash
    let clientConfig: { namespace: 'actor' | 'task', id: string };
    
    const actor = await client.actor(actorOrTaskId).get();
    if (actor) {
        log.info(`Provided actorOrTaskId is an actor, will scan it's runs`);
        clientConfig = {
            namespace: 'actor',
            id: actorOrTaskId,
        };
    } else {
        // Actor not found, it is a task or wrong ID was provided
        const task = await client.task(actorOrTaskId).get();
        if (!task) {
            throw `Cannot load actor or task with the specified ID ${actorOrTaskId}, is this ID correct?`;
        }
        log.info(`Provided actorOrTaskId is a task, will scan it's runs`);
        clientConfig = {
            namespace: 'task',
            id: actorOrTaskId,
        };
    }
    
    let allRuns: ActorRun[] = [];

    const dateFromAsDate = dateFrom ? new Date(dateFrom) : null;
    const dateToAsDate = dateTo ? new Date(dateTo) : null;
    log.info(`From date: ${dateFromAsDate}, to date: ${dateToAsDate}`);

    let offset = 0;
    const limit = 1000;
    for (;;) {
        const { items } = await client[clientConfig.namespace](clientConfig.id)
            .runs().list({ offset, limit, desc: true });
        allRuns.push(...items);
        const doStop = items.length < 1000 || (dateFromAsDate && items[items.length - 1].startedAt < dateFromAsDate);
        log.info(`Loaded ${items.length} runs with offset ${offset}, ${doStop ? 'Loading finished' : 'Loading next batch'}`);
        if (doStop) {
            break;
        }

        offset += limit;
    }
    log.info(`Total loaded runs: ${allRuns.length}`);
    

    const filteredRuns = allRuns.filter((run) => {
        const { startedAt } = run;
        const fitsDateFrom = dateFromAsDate ? startedAt >= dateFromAsDate : true;
        const fitsDateTo = dateToAsDate ? startedAt <= dateToAsDate : true;
        if (fitsDateFrom && fitsDateTo) {
            log.info(`Run startedAt ${startedAt} fits into the chosen date and will be scanned`);
            return true;
        } else {
            log.info(`Run startedAt ${startedAt} doesn't fit into the chosen date and will not be scanned`);
            return false;
        }
    });

    log.info(`Runs that fit into dates: ${filteredRuns.length}`);
    return filteredRuns;
}