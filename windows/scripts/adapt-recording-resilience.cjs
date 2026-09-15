// Replay the pinned Ta delta after adapt-window-resize restores main/WGC files.
const fs=require('fs'),path=require('path'),root=path.resolve(__dirname,'../..');
const main=path.join(root,'windows/native/openscreen-wgc/src/main.cpp');
if(!fs.readFileSync(main,'utf8').includes('Ta live source switch:')){
  const patch=JSON.parse(fs.readFileSync(path.join(__dirname,'patches/recording-resilience.patch.json'),'utf8')).join('\n').replace(/\r\n/g,'\n');
  for(const part of patch.split('diff --git ').slice(1)){
    const file=part.match(/^a\/(\S+) b\//)?.[1];
    if(!['windows/native/openscreen-wgc/src/main.cpp','windows/native/openscreen-wgc/src/wgc_session.cpp'].includes(file))throw Error('Unexpected native patch target');
    const target=path.join(root,file);let text=fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n'),cursor=0;
    for(const chunk of part.split(/^@@.*@@.*\n/m).slice(1)){
      const lines=chunk.split('\n').filter(line=>/^[ +\-]/.test(line)),before=lines.filter(l=>l[0]!=='+' ).map(l=>l.slice(1)).join('\n'),after=lines.filter(l=>l[0]!=='-').map(l=>l.slice(1)).join('\n');
      const at=text.indexOf(before,cursor);if(at<0)throw Error('Native replay anchor changed: '+file);
      text=text.slice(0,at)+after+text.slice(at+before.length);cursor=at+after.length;
    }
    fs.writeFileSync(target,text);
  }
}
