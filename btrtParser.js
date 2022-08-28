const { EventEmitter } = require('events');
const VAL_LENGTH = 4; //bytes
const HEADER_TAG = 'FF45';
const TRAILER_TAG = 'FF46';

const SPECIAL_CARACTERS = {
    13: '\r',
    10: '\n',
};

class BtrtParser extends EventEmitter  {
    constructor(options) {
        const {batchSize, ...other} = options;
        super(other);
        this.batchSize = batchSize;
        this.on('continue_parsing', () => this.parse())
    }
    valLength = VAL_LENGTH;
    currentTagValLen = 0;
    applicationInOneFile = 0;
    _resolve = null;
    _parsedChunks = [];
    _header = {};
    _notParsedHeader = '';
    _bodyApplJSON = {};
    _bodyApplsArr = [];
    _notParsedBody = {};
    _trailer = {};
    _notParsedTrailer = '';
    _chunks = []
    
    async parse(mainBtrtStr = Buffer.from([])) {
        if (typeof mainBtrtStr === 'string') {
            let parse =true;
            let notParsedStr = mainBtrtStr;

            while (parse) {
                if (!notParsedStr.length && !this._chunks.length) {
                    parse = false;
                    break;
                };

                await checkEventLoop();

                let tagType, chunkStr,parentTagType, parentName = '';
                const lastElem = this._chunks.length - 1
                const chunk = this._chunks[lastElem];
                if (chunk) ({chunkStr, parentTagType, parentName/*, parsedFinish*/} = chunk)
                let [tagName, len, tagVal, parsedEndPos, hexLenVal] = this._parse(chunkStr || notParsedStr);
                tagType = this._checkTagType(tagName);
                
                if (tagType === 'header') {
                    this._chunks.push({chunkStr: tagVal, parentTagType: 'header', parentName: tagName/*, parsedFinish: false*/});
                    notParsedStr = removeSpecialCharacters(notParsedStr.slice(parsedEndPos/* + 2*/));
                    this._notParsedHeader = `${tagName}${hexLenVal}${tagVal}`
                    this._header[tagName] = {};
                    this.emit('header');
                    // parse = false;
                    continue;
                } else if (tagType === 'simpeTag') {
                    const parentTags = parentName.split('.');
                    let perentSection = parentTagType === 'header' || parentTagType === 'trailer' ?
                        this[`_${parentTagType}`] : 
                        this._bodyApplJSON;
                    let parentObj = null;
                    parentTags.forEach(parentTag => {
                        parentObj = parentObj ? parentObj[parentTag] : perentSection[parentTag];
                    });
                    parentObj[tagName] = tagVal.toString('utf-8');

                    chunkStr = chunkStr.slice(parsedEndPos);
                    
                    if (!chunkStr.length || chunkStr.length === 1) {
                        this._chunks.splice(lastElem, 1);
                        continue
                    }
                    chunk.chunkStr = chunkStr;
                } else if (tagType === 'combineTag') {
                    const parentTags = parentName.split('.');
                    let perentSection = parentTagType === 'header' || parentTagType === 'trailer' ?
                        this[`_${parentTagType}`] : 
                        this._bodyApplJSON;
                    let parentObj = null;
                    parentTags.forEach(parentTag => {
                        parentObj = parentObj ? parentObj[parentTag] : perentSection[parentTag];
                    });
                    parentObj[tagName] = {};

                    let {chunkStr} = chunk;
                    const perentChunkLen = chunkStr.length
                    if (perentChunkLen > parsedEndPos) {
                        chunk.chunkStr = chunkStr.slice(parsedEndPos);
                    } else if (perentChunkLen === parsedEndPos) {
                        this._chunks.splice(lastElem, 1);
                    }
                    this._chunks.push({chunkStr: tagVal, parentTagType: chunk.parentTagType, parentName: `${chunk.parentName}.${tagName}`});
                    continue;
                } else if (tagType === 'applicationTag') {
                    this.applicationInOneFile++;
                    // if (this.applicationInOneFile > this.batchSize) {
                    //     App.getInstance().logger.error(`File too large. Batch size exceeded. Current batch size ${this.batchSize}`);
                    //     throw ErrorFactoryBase.create.ERROR('File too large. Batch size exceeded.') 
                    // }
                    const applicationObj = {}
                    this._bodyApplJSON[tagName] = applicationObj;
                    this._bodyApplsArr.push({[tagName]: applicationObj});
                    this._chunks.push({chunkStr: tagVal, parentTagType: 'applicationTag', parentName: `${tagName}`});
                    notParsedStr = removeSpecialCharacters(notParsedStr.slice(parsedEndPos/* + 2*/));
                    this._notParsedBody[tagName] = `${tagName}${hexLenVal}${tagVal}`;
                    this.emit('applicationTag');
                    // parse = false;
                    continue;
                } else if (tagType === 'trailer') {
                    this._chunks.push({chunkStr: tagVal, parentTagType: 'trailer', parentName: `${tagName}`});
                    notParsedStr = removeSpecialCharacters(notParsedStr.slice(parsedEndPos/* + 2*/));
                    this._notParsedTrailer = `${tagName}${hexLenVal}${tagVal}`
                    this._trailer[tagName] = {};
                    this.emit('trailer');
                    // parse = false;
                }
            };
        } else {
            throw 'data not instanse of Buffer'
        }
        return [{header: this._header, body: this._bodyApplsArr.map(item => Object.assign({}, item)), trailer: this._trailer}, 
            {header: this._notParsedHeader, body: this._notParsedBody, trailer: this._notParsedTrailer}];
    }

    _checkTagType(tagName) {
        if (tagName === HEADER_TAG) return 'header';
        else if (tagName === TRAILER_TAG) return 'trailer';
        else if (tagName.startsWith('FFFF')) return 'applicationTag';
        else if (tagName.startsWith('FF')) return 'combineTag';
        else if (tagName.startsWith('DF')) return 'simpeTag';
        return undefined;
    }

    _getTagName(string){
        let counter = 0
        let getTagByte = true;
        const tagNamePart = [];
        let pos = 2;

        while (getTagByte) {
            let slice = string.slice(pos - 2, pos);

            const hex = Buffer.from([Number(`0x${slice}`)], 'hex')[0];
            tagNamePart.push(slice);
            if (hex >> 7 === 1) {
                pos = pos + 2;
            } else {
                getTagByte = false;
            }
            counter = counter + 2;    
        }

        return [tagNamePart.join(''), counter ]
    }

    _getTagLength(binaryBuf) {
        let counter = 0
        let parse = true;
        const lenValPart = [];
        let pos = 2;
        let hexLenVal = undefined;

        while (parse) {
            let slice = binaryBuf.slice(pos - 2, pos).toString('utf-8');
            // const hex = Buffer.from([Number(`0x${slice}`)], 'hex')[0];
            lenValPart.push(slice);
            pos = pos + 2;
            counter = counter + 2;
            const parsedElem = lenValPart.length
            
            let firstElem = lenValPart[0];
            const startsWith_8 = firstElem.startsWith('8')  
            
            if (parsedElem === 2) {         
                parse = false;
                if (startsWith_8) {
                    hexLenVal = lenValPart.join('');
                    firstElem = firstElem.substr(1);
                    lenValPart.shift();
                    lenValPart.unshift(firstElem);
                }

            } else if (!startsWith_8) {
                parse = false;
            }
            hexLenVal = hexLenVal ? hexLenVal : lenValPart.join('')
        }
        return [lenValPart.join(''), counter,  hexLenVal]
    }

    _parseHexStrToDec(str) {
        return Number(`0x0${str}`);
    }

    _getTagVal(buf, valLength, tagNameLen, tagLenInDec) {
        // tagLenInDec = tagLenInDec === 1 ? tagLenInDec : tagLenInDec + 1;
        const startsWith = tagNameLen + valLength;
        const endTo = startsWith + tagLenInDec;
        const res = buf.slice(startsWith, endTo);
        return [res, endTo];s
    }

    _parse(binaryBuf) {
        const [tagName, tagNameLen] = this._getTagName(binaryBuf);
        const [tagLenInHex, lenVal, hexLenVal] = this._getTagLength(binaryBuf.slice(tagNameLen),'length');
        const tagLenInDec = this._parseHexStrToDec(tagLenInHex);
        
        const [tagVal, parsedEndPos] = this._getTagVal(binaryBuf, lenVal, tagNameLen, tagLenInDec);

        return [tagName, tagNameLen, tagVal, parsedEndPos, hexLenVal];
    }

    setThrottel(throttel) {
        this._resolve = throttel
    }

    getRes() {
        return {header: this._header, body: this._bodyApplJSON, trailer: this._trailer};
    }
}

const removeSpecialCharacters = (string) => {
    // let round = 3;
    let shift = 0;
    for (let i = 0; string.length > i; i++) {
        const char = string[i];
        const charCode = char.charCodeAt();
        const isSpecChar = SPECIAL_CARACTERS[charCode];
        if(isSpecChar) shift++
        else return string.length === shift ? '' : string.slice(shift);
    }
    return string.length === shift ? '' : string.slice(shift);
}

const checkEventLoop = () => {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, 0);
    })
}

module.exports = BtrtParser;