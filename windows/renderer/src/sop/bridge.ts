import type { SopDocument, SopImage, SopProgress, SopVersion } from '../../../electron/sop/model'
import type { VideoProject } from '../../../electron/video/model'
export type * from '../../../electron/sop/model'
declare global { interface Window { taSop: {
  get(id:string):Promise<SopDocument>; save(d:SopDocument):Promise<SopDocument>;
  generate(id:string):Promise<SopDocument>;chat(id:string,prompt:string,selected:string|undefined,time:number):Promise<SopDocument>;
  cancel(id:string):Promise<void>;frame(id:string,time:number):Promise<SopImage>;
  image(id:string,paste:boolean):Promise<SopImage|undefined>;
  transform(id:string,image:SopImage,mode:string,rect:{x:number;y:number;width:number;height:number}):Promise<SopImage>;
  versions(id:string):Promise<SopVersion[]>;restore(id:string,revision:number):Promise<SopDocument>;
  subtitles(id:string):Promise<SopDocument|undefined>;transcribe(id:string,model:string):Promise<SopDocument>;
  importVideo():Promise<VideoProject|undefined>;export(id:string,format:string):Promise<string|undefined>;
  onProgress(fn:(p:SopProgress)=>void):()=>void;
} } }
