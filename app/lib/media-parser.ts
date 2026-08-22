export type DebridFile={index:number;name:string;size:number;path:string};
export type DebridMagnetRecord={id:number;filename:string;statusCode:number;uploadDate?:number;videoFiles:DebridFile[]};
export type CatalogEpisode={magnetId:number;file:number;name:string;season:number;episode:number;size:number;needsAudioCompatibility:boolean};
export type CatalogTitle={id:string;title:string;category:'movie'|'series';year?:number;seasonCount:number;episodes:CatalogEpisode[];addedAt:number};

const releaseNoise=/\b(?:2160p|1080p|720p|480p|uhd|bluray|blu-ray|web[ ._-]?dl|webrip|brrip|dvdrip|remux|hdr|hevc|x26[45]|h26[45]|av1|aac|eac3|dts|atmos|multi|french|vostfr|proper|repack|extended|unrated|10bit).*$/i;
const episodePattern=/(?:^|[^a-z0-9])S(\d{1,2})E(\d{1,3})(?:[ ._-]*E?(\d{1,3}))?/i;
const seasonPattern=/(?:^|[^a-z0-9])(?:S(?:eason)?[ ._-]?)(\d{1,2})(?:[ ._-]*(?:-|to)[ ._-]*S?(\d{1,2}))?/i;

export const cleanReleaseName=(value:string)=>value.replace(/\.[a-z0-9]{2,5}$/i,'').replace(/[._]+/g,' ').replace(/\[[^\]]*]/g,' ').replace(releaseNoise,'').replace(/[\s-]+$/,'').replace(/\s+/g,' ').trim();
const slug=(value:string)=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90);
const yearFrom=(value:string)=>Number(value.match(/\b(19\d{2}|20\d{2})\b/)?.[1])||undefined;
const seriesTitle=(value:string)=>cleanReleaseName(value.split(episodePattern)[0].split(seasonPattern)[0]).replace(/^www\s+[a-z0-9]+\s+(?:org|com)\s*-?\s*/i,'').replace(/\s*\((?:19|20)\d{2}\)\s*$/,'').replace(/\s+(?:complete|collection)$/i,'').trim();

export function groupDebridCatalog(magnets:DebridMagnetRecord[]):CatalogTitle[]{
  const series=new Map<string,CatalogTitle>(); const movies:CatalogTitle[]=[];
  for(const magnet of magnets.filter(item=>item.statusCode===4)){
    const looksSeries=episodePattern.test(magnet.filename)||seasonPattern.test(magnet.filename)||magnet.videoFiles.some(file=>episodePattern.test(file.name));
    if(looksSeries){
      const title=seriesTitle(magnet.filename)||seriesTitle(magnet.videoFiles[0]?.name||'Series'); const key=slug(title); const existing=series.get(key)||{id:`series-${key}`,title,category:'series' as const,year:yearFrom(magnet.filename),seasonCount:0,episodes:[],addedAt:magnet.uploadDate||0};
      magnet.videoFiles.forEach(file=>{const match=file.name.match(episodePattern);const season=Number(match?.[1]||magnet.filename.match(seasonPattern)?.[1]||1);const episode=Number(match?.[2]||file.index+1);existing.episodes.push({magnetId:magnet.id,file:file.index,name:cleanReleaseName(file.name),season,episode,size:file.size,needsAudioCompatibility:/\b(?:e-?ac-?3|eac3|dts(?:-?hd)?|truehd|ac-?3)\b/i.test(`${magnet.filename} ${file.name}`)})});
      existing.addedAt=Math.max(existing.addedAt,magnet.uploadDate||0);existing.seasonCount=new Set(existing.episodes.map(item=>item.season)).size;series.set(key,existing);
    }else{
      magnet.videoFiles.forEach(file=>{const title=cleanReleaseName(file.name)||cleanReleaseName(magnet.filename);movies.push({id:`movie-${magnet.id}-${file.index}`,title,category:'movie',year:yearFrom(file.name)||yearFrom(magnet.filename),seasonCount:0,episodes:[{magnetId:magnet.id,file:file.index,name:title,season:0,episode:0,size:file.size,needsAudioCompatibility:/\b(?:e-?ac-?3|eac3|dts(?:-?hd)?|truehd|ac-?3)\b/i.test(`${magnet.filename} ${file.name}`)}],addedAt:magnet.uploadDate||0})});
    }
  }
  return [...series.values(),...movies].map(item=>({...item,episodes:item.episodes.sort((a,b)=>a.season-b.season||a.episode-b.episode)})).sort((a,b)=>b.addedAt-a.addedAt||a.title.localeCompare(b.title));
}
