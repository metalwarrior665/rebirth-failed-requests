There isn't an easy way on Apify to retry fully failed (or just handled) requests. This actor allows you to set those requests to pristine unhandled state with 0 retries so you can resurrect the run and process them again.

## How it works
This actor scans all requests in a queue of a run and recognizes failed requests by their `retryCount` and `errorMessages` properties. If your actor deliberately changes these 2 properties (outside of the default Crawler behavior), the rebirth will not work properly.

## Requirements
- Runs must use request queue. (Request list support might be added in the future)
- The run should be able to be resumed with a proper state management (imagine actor migration)

## How to run
Detailed input description is available on [actor's page](https://apify.com/lukaskrivka/rebirth-failed-requests/input-schema).

- You can provide either:
    - **run IDs** to scan for requests to be rebirth
    - **actor or task ID** with combination of dates to find all runs in that timespan (to scan for requests to be rebirth)
- After requests are rebirth, you will see unhandled requests in the run's queue and you can resurrect the runs to get them processed again
- You can check automatic resurrecting of runs with specified concurrency (to work with your max memory limit)
- You can override a build. Normally, the actor is resurrected with the same build it had but often you might want to run newest version like `latest`

