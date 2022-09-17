const path = require('path');
const fs = require('fs').promises;
const assert = require('assert');
const Btrt = require('../btrt');

describe("BTRT parser", () => {
    it("Read correct btrt file BTRT_20140213_123523_0437=30.txt and parse it, should return array with 2 object", async () => {
        //Arrange
        const inst = new Btrt();
        const filePath = path.join(process.cwd(), 'example_files', 'BTRT_20140213_123523_0437=30.txt');
        const file = await fs.readFile(filePath, 'utf8');

        //Act

        const res = await inst.parse(file);
        const [parsedObj] = res;
        console.log(parsedObj.header.FF45)
        
        //Assert
        assert.equal(parsedObj.header.FF45.FF49.DF807C, "13.02.2014_12:35:23");
        assert.equal(parsedObj.body[0].FFFF0D.FF20.DF8003, "00006853");
    })
}) 