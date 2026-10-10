const fs=require('fs'),path=require('path'),file=path.resolve(__dirname,'../native/openscreen-wgc/src/main.cpp');
let s=fs.readFileSync(file,'utf8');
if(!s.includes('#include "ta_audio_only.h"')){
  const a='} // namespace',b='    char injectDefaultSinkWriterFailure[2]{};';
  if(!s.includes(a)||!s.includes(b))throw Error('Audio adapter anchors changed');
  s=s.replace(a,'#include "ta_audio_only.h"\n\n'+a).replace(b,'    if(config.sourceType=="audio")return taRecordAudio(config);\n\n'+b);
  fs.writeFileSync(file,s);
}
