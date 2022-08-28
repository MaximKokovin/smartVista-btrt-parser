const crypto = require('crypto');
const BtrtParser = require('./btrtParser');

class BTRT {
    constructor(options) {
        this._parser = new BtrtParser(options);
    }

    async parse(btrtString, token, opt) {
        if (typeof btrtString !== 'string') throw new Error(`${btrtString} not instanse of string`);
        
        const operationToken = !token ? crypto.randomBytes(64).toString('hex') : token;
       
        try {
            const res = await this._parser.parse(btrtString, operationToken, opt);
            return [...res, null];
       } catch (err) {
            return [null, null, err];
       } 
       
    }

    setCallBack(eventName, cb, opt) {
        this._parser.on(eventName, cb, opt);
    }
}


module.exports = BTRT;


