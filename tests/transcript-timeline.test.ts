import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transcriptAt} from '../lib/timeline.ts';
const blocks=[{id:'a',start:2.23,end:45.1},{id:'b',start:45.1,end:86.5},{id:'c',start:100,end:110},{id:'d',start:120,end:null},{id:'e',start:130,end:150}];
test('video seeks forward and backward identify the matching transcript block',()=>{assert.equal(transcriptAt(blocks,46)?.id,'b');assert.equal(transcriptAt(blocks,101)?.id,'c');assert.equal(transcriptAt(blocks,4)?.id,'a');assert.equal(transcriptAt(blocks,130)?.id,'e');});
test('fractional boundaries, gaps and absent timing do not invent an active block',()=>{assert.equal(transcriptAt(blocks,0),null);assert.equal(transcriptAt(blocks,45.099)?.id,'a');assert.equal(transcriptAt(blocks,45.1)?.id,'b');assert.equal(transcriptAt(blocks,90),null);assert.equal(transcriptAt(blocks,110),null);assert.equal(transcriptAt(blocks,125)?.id,'d');assert.equal(transcriptAt(blocks,150),null);assert.equal(transcriptAt([],50),null);assert.equal(transcriptAt([{start:null,end:null}],1),null);});
