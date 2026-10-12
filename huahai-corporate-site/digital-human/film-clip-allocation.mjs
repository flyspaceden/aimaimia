// 跨句分配唯一片源，先解决稀缺场景，再按原时序输出；不循环片源凑时长。
export function allocateFilmClips({timeline,storyboard,clips,reserve,fps,totalFrames,maxSeconds=18}){
 const counts=timeline.map((t,i)=>Math.ceil(((i===timeline.length-1?totalFrames:Math.round(timeline[i+1].start*fps))-(i===0?0:Math.round(t.start*fps)))/(fps*maxSeconds)));
 const queue=[counts],seen=new Set([counts.join(',')]);
 for(let attempt=0;queue.length&&attempt<4096;attempt++){
  const counts=queue.shift();
  const slots=[];
  for(let cue=0;cue<timeline.length;cue++){
   const scenes=[...storyboard[cue].shotScenes];if(scenes.includes('tablet'))scenes.push('delivery','family');if(scenes.includes('sensors'))scenes.push('tablet','aquaculture','production');
   let start=cue===0?0:Math.round(timeline[cue].start*fps);const end=cue===timeline.length-1?totalFrames:Math.round(timeline[cue+1].start*fps);
   for(let part=0;part<counts[cue];part++){const frames=Math.round((end-start)/(counts[cue]-part));if(frames<1)throw new Error('Invalid scene duration');const edges=clips.map((c,i)=>({c,i})).filter(({c})=>scenes.includes(c.scene)&&Math.floor((c.duration-.12)*fps)>=frames).sort((a,b)=>Number(reserve[a.c.id]!==cue)-Number(reserve[b.c.id]!==cue)||a.c.duration-b.c.duration||a.c.id.localeCompare(b.c.id)).map(({i})=>i);slots.push({cue,part,startFrame:start,endFrame:start+frames,frames,edges});start+=frames;}
  }
  if(slots.length>clips.length)continue;
  const owners=new Map(),assigned=new Map();
  function match(slot,seen){for(const clip of slots[slot].edges){if(seen.has(clip))continue;seen.add(clip);if(!owners.has(clip)||match(owners.get(clip),seen)){owners.set(clip,slot);assigned.set(slot,clip);return true;}}return false;}
  const order=slots.map((_,i)=>i).sort((a,b)=>slots[a].edges.length-slots[b].edges.length||slots[b].frames-slots[a].frames),failed=[];
  for(const slot of order)if(!match(slot,new Set()))failed.push(slot);
  if(!failed.length)return slots.map((s,i)=>({...s,clipId:clips[assigned.get(i)].id}));
  // 增加一次剪切让剩余短片也可使用；每段仍来自不同、主题匹配的片源。
  const candidates=[...new Set(failed.map(i=>slots[i].cue)),...counts.map((_,i)=>i)];
  for(const cue of new Set(candidates)){const scenes=[...storyboard[cue].shotScenes];if(scenes.includes('tablet'))scenes.push('delivery','family');if(scenes.includes('sensors'))scenes.push('tablet','aquaculture','production');if(counts[cue]+1>clips.filter(c=>scenes.includes(c.scene)).length)continue;const next=[...counts];next[cue]++;if(next.reduce((a,b)=>a+b,0)>clips.length)continue;const key=next.join(',');if(!seen.has(key)){seen.add(key);queue.push(next);}}
 }
 throw new Error('No unique scene allocation found within the search budget');
}
