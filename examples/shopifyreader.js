/* Example FSM for reading the paginated results of the shopify REST API.
 *
 */ 

const fsm = require('../lib/fsm.js');
const https = require('https');

const STATES = fsm.makeStates(
    "PRE_REQUEST", // enter a subdirectory
    "POST_REQUEST",  // exit a subdirectory into parent, aka ".."
    "FINISHED"   // entire path parsed
);

const debase64 = (str) => Buffer.from(str, 'base64').toString('ascii');

const makeRequest = (requestSpec, acc = []) => {
    ({store, username, password, endpoint, limit, pageInfo} = requestSpec);
    // from: https://dzone.com/articles/nodejs-call-https-basic
    const options = {
        host: `${store}.myshopify.com`,
        port: 443,
        path: `/admin/api/2020-04/${endpoint}.json?limit=${limit}`,
        headers: {
            // HTTP basic auth
            'Authorization': 'Basic ' + Buffer.from(username + ':' + password).toString('base64')
        }};
    if (pageInfo) {
        options.path += `&page_info=${pageInfo}`;
    }
    return new Promise((resolve, reject) => {
        let body = "";
        const req = https.request(options, res => {
            res.on('data', (data) => {
                body += data;
            });
            res.on('end', () => resolve([{requestSpec, body, link: res.headers.link}, acc]));
        });
        req.on('error', reject);
        req.end();
    });
};

const RE_LINK = new RegExp('<.*&page_info=(.*)>; rel="next"$');

const parseResponse = ({requestSpec, body, link}, acc) => {
    const data = acc.concat(JSON.parse(body)[requestSpec.endpoint]);
    // parse link
    if (link) {
        // console.log(link.replace(/ /gi, "\n"));
        // sometimes there is a prev and next, sometimes just next
        const pageInfoMatch = link.split(", ").slice(-1)[0].match(RE_LINK);
        if (pageInfoMatch) {
            const pageInfo = pageInfoMatch[1];
            console.log(`pageInfo ${debase64(pageInfo)}`)
            return [STATES.PRE_REQUEST, Object.assign({}, requestSpec, {pageInfo}), data];
        }
    }
    // last page
    return [STATES.FINISHED, data]
};

const makeShopifyReaderFSM = () => {
    const srFsm = new fsm.FSM(STATES.PRE_REQUEST);
    srFsm.addTransition(STATES.PRE_REQUEST, {nextState: STATES.POST_REQUEST, transitionFn: makeRequest});
    srFsm.addTransition(STATES.POST_REQUEST, {transitionFn: parseResponse});
    return srFsm;
};

// main
fsm.runFSM(
    makeShopifyReaderFSM(),
    STATES.FINISHED,
    { store: 'my-shopify-store',
      username: '..apiuser..',
      password: '..apisecret..',
      endpoint: 'events',
      limit: 1
    })
    .then(([_state, result]) => result)
    .then(console.log, console.warn);
