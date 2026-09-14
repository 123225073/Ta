/** Only the owned editor may enter HTML fullscreen; capture permissions stay denied. */
export function allowEditorPermission(permission:string, senderId:number|undefined, editorId:number|undefined) {
  return permission==='fullscreen'&&editorId!==undefined&&senderId===editorId
}
