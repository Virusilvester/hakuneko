import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';

export default class MangaDex extends Connector {

    constructor() {
        super();
        super.id = 'mangadex';
        super.label = 'MangaDex';
        this.tags = [ 'manga', 'high-quality', 'multi-lingual' ];
        this.url = 'https://mangadex.org';
        this.api = 'https://api.mangadex.org';
        this.requestOptions.headers.set('x-referer', this.url);
        this.requestOptions.headers.set('x-sec-ch-ua', '" Not A;Brand";v="99", "Chromium";v="96", "Google Chrome";v="96"');
        this.config = {
            throttleRequests: {
                label: 'Throttle API Requests [ms]',
                description: 'Enter the timespan in [ms] to delay consecuitive requests to the api.',
                input: 'numeric',
                min: 100,
                max: 10000,
                value: 2000
            },
            throttle: {
                label: 'Throttle Image Requests [ms]',
                description: 'Enter the timespan in [ms] to delay consecuitive HTTP requests.\nThe website may block images for to many consecuitive requests.',
                input: 'numeric',
                min: 50,
                max: 5000,
                value: 500
            }
        };
        this.licensedChapterGroups = [
            '4f1de6a2-f0c5-4ac5-bce5-02c7dbb67deb', // MangaPlus
            '8d8ecf83-8d42-4f8c-add8-60963f9f28d9' // Comikey
        ];
        this.serverNetwork = [
            'https://uploads.mangadex.org/data/'
        ];
    }

    async _initializeConnector() {
        //this.serverNetwork.push('https://reh3tgm2rs8sr.xnvda7fch4zhr.mangadex.network/data/');
        //this.serverNetwork.push('https://bddhaec337xvm.xnvda7fch4zhr.mangadex.network/data/');
        this.serverNetwork.push('https://cache.ayaya.red/mdah/data/');
        console.log(`Added Network Seeds '[ ${this.serverNetwork.join(', ')} ]' to ${this.label}`);
        // Try to load MangaDex in a browser window to get cookies,
        // but don't block initialization if this fails (e.g. when remote API is unavailable)
        try {
            const request = new Request(this.url, this.requestOptions);
            await Engine.Request.fetchUI(request, '');
        } catch(error) {
            console.warn(`[${this.label}] Browser-based initialization failed (this is OK, continuing without cookies):`, error.message || error);
        }
    }

    canHandleURI(uri) {
        // See: https://www.reddit.com/r/mangadex/comments/nn584s/list_of_appssites_that_currently_use_the_mangadex/
        return [
            /https?:\/\/mangadex\.org\/title\//,
            /https?:\/\/mangastack\.cf\/manga\//,
            /https?:\/\/manga\.ayaya\.red\/manga\//,
            /https?:\/\/(www\.)?chibiview\.app\/manga\//,
            /https?:\/\/cubari\.moe\/read\/mangadex\//
        ].some(regex => regex.test(uri.href));
    }

    async _getMangaFromURI(uri) {
        // NOTE: The MangaDex website is still down, but there are some provisional frontends which can be used for search, copy & paste
        const regexGUID = /[a-fA-F0-9]{8}-([a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}/;
        const id = (uri.pathname.match(regexGUID) || uri.hash.match(regexGUID))[0].toLowerCase();
        const request = new Request(new URL('/manga/' + id, this.api), this.requestOptions);
        const {data} = await this.fetchJSON(request);
        return new Manga(this, id, data.attributes.title.en || Object.values(data.attributes.title).shift());
    }

    async _getMangas() {
        try {
            const data = await this.fetchJSON('https://websites.hakuneko.download/mangadex.json');
            if(!Array.isArray(data)) {
                throw new Error('Manga list response is not an array');
            }
            return data.map(manga => ({
                id: manga.id,
                title: manga.title,
            }));
        } catch(error) {
            console.warn(`[${this.label}] Failed to fetch manga list from hakuneko server:`, error.message || error);
            // Return empty list instead of crashing — user can still add manga via URL
            return [];
        }
    }

    async _getChapters(manga) {
        let chapterList = [];
        for(let page = 0, run = true; run; page++) {
            try {
                let chapters = await this._getChaptersFromPage(manga, page);
                chapters.length > 0 ? chapterList.push(...chapters) : run = false;
            } catch(error) {
                console.error(`[${this.label}] Failed to fetch chapters page ${page} for manga ${manga.id}:`, error.message || error);
                run = false;
            }
        }
        return chapterList.reverse();
    }

    async _getChaptersFromPage(manga, page) {
        await this.wait(this.config.throttleRequests.value);
        const uri = new URL('/chapter', this.api);
        uri.searchParams.set('limit', 100);
        uri.searchParams.set('offset', 100 * page);
        uri.searchParams.append('contentRating[]', 'safe');
        uri.searchParams.append('contentRating[]', 'suggestive');
        uri.searchParams.append('contentRating[]', 'erotica');
        uri.searchParams.append('contentRating[]', 'pornographic');
        // MangaDex v5 API uses plain 'manga' (not 'manga[]') for single manga ID filter
        uri.searchParams.set('manga', manga.id);
        uri.searchParams.set('includes[]', 'scanlation_group');
        const request = new Request(uri, this.requestOptions);
        const response = await this.fetchJSONWithStatus(request, 3);
        if (!response || response.result === 'error') {
            console.warn(`[${this.label}] Chapter API returned error for page ${page}:`, response);
            return [];
        }
        const {data} = response;
        if (!data || !Array.isArray(data) || data.length === 0) {
            return [];
        }
        const groupMap = await this._getScanlationGroups(data);
        return data.map(result => {
            let title = '';
            if(result.attributes.volume) {
                title += 'Vol.' + this._padNum(result.attributes.volume, 2);
            }
            if(result.attributes.chapter) {
                title += ' Ch.' + this._padNum(result.attributes.chapter, 4);
            }
            if(result.attributes.title) {
                title += (title ? ' - ' : '') + result.attributes.title;
            }
            if(result.attributes.translatedLanguage) {
                title += ' (' + result.attributes.translatedLanguage + ')';
            }
            const groups = (result.relationships || []).filter(r => r.type === 'scanlation_group');
            if(groups.length > 0) {
                title += ' [' + groups.map(group => groupMap[group.id] || 'unknown').join(', ') + ']';
            }
            // is any group for this chapter not in the list of licensed groups?
            if(groups.length === 0 || groups.some(group => !this.licensedChapterGroups.includes(group.id))) {
                return {
                    id: result.id,
                    title: title.trim() || `Chapter ${result.id}`,
                    language: result.attributes.translatedLanguage
                };
            } else {
                return false;
            }
        }).filter(chapter => chapter);
    }

    /**
     * Extended fetchJSON that returns the full response body (not just json())
     * with retry support and full error detail.
     */
    async fetchJSONWithStatus(request, retries) {
        retries = retries !== undefined ? retries : 0;
        if(typeof request === 'string') {
            request = new Request(request, this.requestOptions);
        }
        if(request instanceof URL) {
            request = new Request(request.href, this.requestOptions);
        }
        try {
            const response = await fetch(request.clone ? request.clone() : request);
            if(response.status >= 500 && retries > 0) {
                await this.wait(5000);
                return this.fetchJSONWithStatus(request, retries - 1);
            }
            if(response.status === 429 && retries > 0) {
                // Rate limited — wait longer and retry
                const retryAfter = parseInt(response.headers.get('retry-after') || '10', 10);
                console.warn(`[${this.label}] Rate limited (429), waiting ${retryAfter}s before retry...`);
                await this.wait(retryAfter * 1000);
                return this.fetchJSONWithStatus(request, retries - 1);
            }
            if(response.ok || response.status === 400) {
                const json = await response.json();
                if(!response.ok) {
                    console.warn(`[${this.label}] API error (${response.status}) at ${request.url}:`, JSON.stringify(json).substring(0, 300));
                }
                return json;
            }
            throw new Error(`Failed to receive content from "${request.url}" (status: ${response.status}) - ${response.statusText}`);
        } catch(error) {
            if(retries > 0) {
                console.warn(`[${this.label}] Request failed, retrying (${retries} left):`, error.message);
                await this.wait(2500);
                return this.fetchJSONWithStatus(request, retries - 1);
            }
            throw error;
        }
    }

    async _getPages(chapter) {
        const uri = new URL('/at-home/server/' + chapter.id, this.api);
        const request = new Request(uri, this.requestOptions);
        const data = await this.fetchJSON(request, 3);
        return data.chapter.data.map(file => this.createConnectorURI({
            networkNode: data.baseUrl + '/data/', // e.g. 'https://foo.bar.mangadex.network:44300/token/data/'
            hash: data.chapter.hash, // e.g. '1c41e55e32b21321ff11907469e5c323'
            file: file // e.g. 'x1-216a1435.png'
        }));
    }

    async _handleConnectorURI(payload) {
        const servers = [
            ...this.serverNetwork,
            payload.networkNode
        ];
        for(let node of servers) {
            try {
                const uri = new URL(node + payload.hash + '/' + payload.file);
                const request = new Request(uri, this.requestOptions);
                const response = await fetch(request);
                if(response.ok && response.status === 200) {
                    const data = await response.blob();
                    if(response.headers.get('content-length') == data.size || await createImageBitmap(data)) {
                        return this._blobToBuffer(data);
                    }
                }
            } finally {/**/}
        }
        throw new Error('Failed to download image file from MangaDex@Home network!\n' + payload.networkNode);
    }

    async _getScanlationGroups(chapters) {
        const groupList = {};
        if(!chapters || chapters.length === 0) {
            return groupList;
        }

        // First, try to extract group names directly from the included relationship attributes
        // (when we request includes[]=scanlation_group, names are embedded in relationships)
        for(const chapter of chapters) {
            const rels = chapter.relationships || [];
            for(const rel of rels) {
                if(rel.type === 'scanlation_group' && rel.id) {
                    if(rel.attributes && rel.attributes.name) {
                        groupList[rel.id] = rel.attributes.name;
                    }
                }
            }
        }

        // Collect any group IDs that didn't have embedded name attributes
        let missingIDs = chapters.reduce((accumulator, chapter) => {
            const ids = (chapter.relationships || [])
                .filter(r => r.type === 'scanlation_group' && r.id && !groupList[r.id])
                .map(g => g.id);
            return accumulator.concat(ids);
        }, []);
        missingIDs = Array.from(new Set(missingIDs));

        if(missingIDs.length > 0) {
            try {
                await this.wait(this.config.throttleRequests.value);
                const uri = new URL('/group', this.api);
                uri.search = new URLSearchParams([ [ 'limit', 100 ], ...missingIDs.map(id => [ 'ids[]', id ]) ]).toString();
                const request = new Request(uri, this.requestOptions);
                const {data} = await this.fetchJSON(request, 3);
                if(data && Array.isArray(data)) {
                    data.forEach(result => groupList[result.id] = result.attributes && result.attributes.name || 'unknown');
                }
            } catch(error) {
                console.warn(`[${this.label}] Failed to fetch scanlation group names:`, error.message || error);
            }
        }
        return groupList;
    }

    _padNum(number, places) {
        /*
         * '17'
         * '17.5'
         * '17-17.5'
         * '17 - 17.5'
         * '17-123456789'
         */
        let range = number.split('-');
        range = range.map(chapter => {
            chapter = chapter.trim();
            let digits = chapter.split('.')[0].length;
            return '0'.repeat(Math.max(0, places - digits)) + chapter;
        });
        return range.join('-');
    }
}
