There isn't an easy way on Apify to retry fully failed (or just handled) requests. This actor allows you to set those requests to pristine unhandled state with 0 retries so you can resurrect the run and process them again.

## How it works
Unfortunately, there is no way to get a list of requests out of the request queue. To work around this, this actor scans a log of the runs and looks for a standard format that logs a failed request with ID or a retry count. It collects all request IDs and then sets them to unhandled state and lowers retryCount to 0.

## Requirements
- Runs must use request queue. (Request list support might be added in the future)
- Runs must contain failed requests in the log in standard format, e.g. `{"url":"https://example.com","retryCount":1,"id":"gBo6trryU3dDU04"}`
- Log must not be cut out by being too big, otherwise some failed requests might be missed
- The run be will resurrected with only the rebirth requests non-handled in the queue so any state has to work with that setting (usually should be fine).

## How to run
Detailed input description is available on [actor's page](https://apify.com/lukaskrivka/rebirth-failed-requests/input-schema).

- You can provide either:
    - **run IDs** to scan for requests to be rebirth
    - **actor or task ID** with combination of dates to find all runs in that timespan (to scan for requests to be rebirth)
- After requests are rebirth, you will see unhandled requests in the runs and you can resurrect the runs to get them processed again
- You can check automatic resurrecting of runs with specified concurrency (to work with your max memory limit)

