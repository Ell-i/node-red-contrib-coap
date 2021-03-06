module.exports = function(RED) {
    "use strict";

    var coap = require('coap');
    var cbor = require('cbor');
    var url = require('uri-js');
    var linkFormat = require('h5.linkformat');

    coap.registerFormat('application/cbor', 60);

    function CoapRequestNode(n) {
        RED.nodes.createNode(this, n);
        var node = this;

        // copy "coap request" configuration locally
        node.options = {};
        node.options.method = n.method;
        node.options.observe = n.observe;
        node.options.observe_deregister = n.observe_deregister;
        node.options.name = n.name;
        node.options.url = n.url;
        node.options.proxy = n.proxy;
        node.options.contentFormat = n['content-format'];
        node.options.outputFormat = n['output-format'];
        node.options.rawBuffer = n['raw-buffer'];

        function _constructPayload(msg, contentFormat) {
            switch (contentFormat) {
            case 'text/plain':       return msg.payload;
            case 'application/json': return JSON.parse(msg.payload);
            case 'application/cbor': return cbor.encode(msg.payload);
            default: return undefined;
            }
        }

        function _makeRequest(msg) {
            var reqOpts = url.parse(node.options.url || msg.url);
            reqOpts.pathname = reqOpts.path;
            reqOpts.method = ( node.options.method || msg.method || 'GET' ).toUpperCase();
            reqOpts.headers = {};
            reqOpts.headers['Content-Format'] = node.options.contentFormat;

            function _onResponse(res) {

                function _send(payload) {
                    switch (node.options.outputFormat) {
                    case 'application/json':
                        const name = reqOpts.pathname.split('/').pop();
                        payload = { [name]: payload };
                        break;
                    }

                    node.send(Object.assign({}, msg, {
                        requestOptions: reqOpts,
                        payload: payload,
                        headers: res.headers,
                        statusCode: res.code,
                    }));
                }

                function _onResponseData(data) {
                    if ( node.options.rawBuffer ) {
                        _send(data);
                    } else if (res.headers['Content-Format'] === 'text/plain') {
                        _send(data.toString());
                    } else if (res.headers['Content-Format'] === 'application/json') {
                        _send(JSON.parse(data.toString()));
                    } else if (res.headers['Content-Format'] === 'application/cbor') {
                        cbor.decodeAll(data, function (err, data) {
                            if (err) {
                                return false;
                            }
                            _send(data[0]);
                        });
                    } else if (res.headers['Content-Format'] === 'application/link-format') {
                        _send(linkFormat.parse(data.toString()));
                    } else {
                        _send(data.toString());
                    }
                }

                res.on('data', _onResponseData);

                if (reqOpts.observe && !reqOpts.observe == 0) {
                    node.stream = res;
                }
            }

            var payload = _constructPayload(msg, node.options.contentFormat);

            if (node.options.observe === true || node.options.observe_deregister === true) {
                if (node.options.observe_deregister === true) {
                    reqOpts.observe = 1; // RFC 7641 Section 2
                } else {
                    reqOpts.observe = 0;
                }
                node.log('observe=' + reqOpts.observe);
            } else {
                delete reqOpts.observe;
            }

            if (node.options.proxy && node.options.proxy.length) {
                const proxy = url.parse(node.options.proxy);
                reqOpts.proxyUri = node.options.url;
                reqOpts.host = proxy.host;
                reqOpts.port = proxy.port;
                delete reqOpts.pathname;
                delete reqOpts.query;
            } else {
                delete reqOpts.proxyUri;
            }

            //TODO: should revisit this block
            if (node.stream && node.stream.close) {
                node.stream.close();
            }

            var req = coap.request(reqOpts);
            req.on('response', _onResponse);
            req.on('error', function(err) {
                node.log('client error');
                node.log(err);
            });

            if (payload) {
                req.write(payload);
            }
            req.end();
        }

        this.on('input', function(msg) {
            _makeRequest(msg);
        });
    }
    RED.nodes.registerType("coap request", CoapRequestNode);
};
