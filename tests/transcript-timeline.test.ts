import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transcriptAt,reviewChecksForBlock,videoStartSeconds} from '../lib/timeline.ts';
import type {Claim} from '../lib/data.ts';
const blocks=[{id:'a',start:2.23,end:45.1},{id:'b',start:45.1,end:86.5},{id:'c',start:100,end:110},{id:'d',start:120,end:null},{id:'e',start:130,end:150}];
test('video seeks forward and backward identify the matching transcript block',()=>{assert.equal(transcriptAt(blocks,46)?.id,'b');assert.equal(transcriptAt(blocks,101)?.id,'c');assert.equal(transcriptAt(blocks,4)?.id,'a');assert.equal(transcriptAt(blocks,130)?.id,'e');});
test('fractional boundaries, gaps and absent timing do not invent an active block',()=>{assert.equal(transcriptAt(blocks,0),null);assert.equal(transcriptAt(blocks,45.099)?.id,'a');assert.equal(transcriptAt(blocks,45.1)?.id,'b');assert.equal(transcriptAt(blocks,90),null);assert.equal(transcriptAt(blocks,110),null);assert.equal(transcriptAt(blocks,125)?.id,'d');assert.equal(transcriptAt(blocks,150),null);assert.equal(transcriptAt([],50),null);assert.equal(transcriptAt([{start:null,end:null}],1),null);});
test('review follows the transcript in both directions, without leaking another video or closed claims',()=>{
 const claims=[
  {id:'draft-a',videoId:'video-one',transcriptBlockId:'a',seconds:2.23,status:'pending',createdAt:1,demo:false},
  {id:'approved-b',videoId:'video-one',transcriptBlockId:'b',seconds:45.1,status:'approved',createdAt:2,demo:false},
  {id:'other-video',videoId:'video-two',transcriptBlockId:'a',seconds:2.23,status:'approved',demo:false},
  {id:'closed',videoId:'video-one',transcriptBlockId:'a',seconds:2.23,status:'closed',demo:false},
  {id:'unlinked-a',videoId:'video-one',seconds:30,status:'pending',createdAt:3,demo:false},
  {id:'wrong-block',videoId:'video-one',transcriptBlockId:'old-transcript',seconds:30,status:'pending',demo:false},
  {id:'example',videoId:'video-one',transcriptBlockId:'a',seconds:2.23,status:'pending',demo:true},
 ] as Claim[];
 const matching=(time:number)=>reviewChecksForBlock(claims,'video-one',transcriptAt(blocks,time)).map(c=>c.id);
 assert.deepEqual(matching(3),['unlinked-a','draft-a']);
 assert.deepEqual(matching(46),['approved-b']);
 assert.deepEqual(matching(90),[]);
 assert.deepEqual(matching(3),['unlinked-a','draft-a']);
 assert.deepEqual(matching(101),[]);
 assert.equal(videoStartSeconds('Gqc1rQtzWUk'),15661.52);
 assert.equal(videoStartSeconds('another-video'),0);
});
