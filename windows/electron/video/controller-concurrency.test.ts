import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoController } from './controller'
import type { RecordingState, RecordingSource, Rect } from './model'

vi.mock('electron',()=>({screen:{screenToDipRect:(_:unknown,r:Rect)=>r}}))

function fixture(phase:RecordingState['phase']) {
  const state:RecordingState={phase,elapsed:0}
  const target:RecordingSource={kind:'window',id:'window:42:0',name:'fixture',thumbnail:'',displayId:'',scale:1}
  const bounds={x:0,y:0,width:1280,height:720,minimized:false}
  let resolve!: (value:typeof bounds)=>void
  const probe=new Promise<typeof bounds>(done=>{resolve=done})
  const write=vi.fn(),create=vi.fn(),windowInfo=vi.fn(()=>probe)
  const controller:VideoController=Object.create(VideoController.prototype)
  Object.assign(controller,{state,bin:'.',sources:[target],windowInfo,send:vi.fn(),health:{reset:vi.fn()},store:{settings:{quality:'balanced'},create},elapsed:()=>0,
    switchSerial:0,currentSource:target,child:phase==='idle'?undefined:{stdin:{write}},project:phase==='idle'?undefined:{id:'fixture'}})
  const internals=controller as unknown as {chooseSource(show:boolean):Promise<void>;switchAck?:{done(ok:boolean):void}}
  return {controller,internals,target,state,write,create,windowInfo,ready:()=>resolve(bounds)}
}

afterEach(()=>vi.restoreAllMocks())

describe('native recording command arbitration',()=>{
  it('reserves the sole session during window lookup and aborts preparation before allocating a project',async()=>{
    vi.spyOn(fs,'existsSync').mockReturnValue(true)
    const f=fixture('idle')
    const options={sourceId:f.target.id,mic:false,micName:'',system:false}
    const pending=f.controller.start(options)
    expect(f.controller.active()).toBe(true)
    await expect(f.controller.start({...options,kind:'audio',system:true})).rejects.toThrow('已有录制')
    await f.controller.stop()
    f.ready()
    await expect(pending).rejects.toThrow('取消')
    expect(f.create).not.toHaveBeenCalled()
    expect(f.controller.active()).toBe(false)
  })

  it('reserves the source switch before lookup and dismisses it without sending a native command',async()=>{
    const f=fixture('recording'),options={sourceId:f.target.id}
    const first=f.controller.switchSource(options)
    expect(f.state.switching).toBe(true)
    await expect(f.controller.switchSource(options)).rejects.toThrow('正在切换')
    await f.internals.chooseSource(false)
    f.ready()
    await expect(first).rejects.toThrow('取消')
    expect(f.write).not.toHaveBeenCalled()
    expect(f.state.switching).toBe(false)
  })

  it('stopping a switch awaiting acknowledgement invalidates it, even if the old acknowledgement arrives later',async()=>{
    const f=fixture('recording')
    const first=f.controller.switchSource({sourceId:f.target.id})
    f.ready()
    await vi.waitFor(()=>expect(f.write).toHaveBeenCalledOnce())
    const ack=f.internals.switchAck!
    const rejected=expect(first).rejects.toThrow('取消')
    await f.controller.stop()
    ack.done(true)
    await rejected
    expect(f.state.phase).toBe('stopping')
    expect(f.state.switching).toBe(false)
    expect(f.write.mock.calls[1][0]).toBe('stop\n')
  })

  it('cannot send a late resume after stop during the window check',async()=>{
    const f=fixture('paused')
    const resume=f.controller.pause(false)
    await f.controller.stop(); f.ready(); await resume
    expect(f.write.mock.calls).toEqual([['stop\n']])
    expect(f.state.phase).toBe('stopping')
  })
})
