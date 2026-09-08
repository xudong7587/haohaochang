import React from 'react';
export function CatalogImport({request,notify}){
 return <details className="settings-card"><summary>扩充可点歌曲目录</summary><p>导入 JSON 数组，每条包含 title、artist；不需要已有媒体。目录条目在在线点歌页面按需下载，不表示资源一定可获取。</p><input aria-label="导入歌曲目录" type="file" accept=".json" onChange={async event=>{try{const file=event.target.files[0];if(!file||file.size>30000)throw new Error('每批文件限制 30 KB');await request('/admin/catalog',{songs:JSON.parse(await file.text())},'POST');notify('歌曲目录已导入');}catch(error){notify(error.message);}}}/></details>;
}
