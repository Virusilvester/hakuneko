const { URL, urlToHttpOptions } = require('url');
const http = require('http');
const https = require('https');
const { ConsoleLogger } = require('@logtrine/logtrine');
const UpdatePackageInfo = require('./UpdatePackageInfo');

module.exports = class UpdateServerManager {

    constructor(applicationUpdateURL, logger) {
        try {
            this._logger = logger || new ConsoleLogger(ConsoleLogger.LEVEL.Warn);
            new URL(applicationUpdateURL);
            this._applicationUpdateURL = applicationUpdateURL;
        } catch(error) {
            this._logger.warn('Initialization of "UpdateServerManager" failed!', error);
            this._applicationUpdateURL = undefined;
        }
    }

    /**
     *
     * @param {string | URL | RequestOptions} options
     */
    _toURL(options) {
        if(options instanceof URL) {
            return options;
        }

        let uri = undefined;
        if(typeof options === 'string') {
            uri = options;
        } else if(options && typeof options.href === 'string') {
            uri = options.href;
        } else if(options && typeof options.url === 'string') {
            uri = options.url;
        }

        if(!uri) {
            throw new Error('Invalid request for connection to the update server!');
        }

        try {
            return new URL(uri);
        } catch(error) {
            throw new Error('Invalid URL: ' + uri);
        }
    }

    /**
     * Download content via HTTP(S).
     * @param {string | URL | RequestOptions} options
     */
    _request(options) {
        return new Promise((resolve, reject) => {
            if(!options) {
                throw new Error('Invalid request for connection to the update server!');
            }
            let uri = this._toURL(options);
            let client = uri.protocol === 'https:' ? https : http;
            let request = client.request({
                ...urlToHttpOptions(uri),
                agent: false,
                headers: {
                    'connection': 'close'
                }
            }, response => {
                if(response.headers.location) {
                    let location = response.headers.location;
                    let redirect = location.startsWith('http') ? new URL(location) : new URL(location, uri);
                    this._request(redirect)
                        .then(data => resolve(data))
                        .catch(error => reject(error));
                    return;
                }
                if(response.statusCode !== 200) {
                    reject(new Error('Status: ' + response.statusCode));
                    return;
                }
                let data = [];
                //response.setEncoding('utf8');
                response.on('data', chunk => data.push(chunk));
                response.on('end', () => resolve(Buffer.concat(data)));
            } );
            request.on('error', error => reject(error));
            //request.write(/* REQUEST BODY */);
            request.end();
        });
    }

    /**
     * @returns {Promise<UpdatePackageInfo>}
     */
    getUpdateInfo() {
        return this._request(this._applicationUpdateURL)
            .then(data => {
                let link = data.toString('utf8').trim();
                let signature = new URL(link, this._applicationUpdateURL).searchParams.get('signature');
                let info = new UpdatePackageInfo(link.split('.')[0], signature, new URL(link, this._applicationUpdateURL).toString());
                return Promise.resolve(info);
            });
    }

    /**
     *
     * @param {UpdatePackageInfo} info The update package information received with getUpdateInfo()
     * @returns {Promise<Uint8Array>} A promise that resolves with the received bytes
     */
    getUpdateArchive(info) {
        return this._request(info.link);
    }
};
