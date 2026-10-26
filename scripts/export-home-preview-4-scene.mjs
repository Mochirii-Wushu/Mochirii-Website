import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=process.cwd(),out=path.join(root,'.artifacts/operations/homepage-preview-4');
const sourceDirectory=process.argv[2];
if(!sourceDirectory)throw Error('Supply the reviewed ignored Preview 4 master directory');
const sharp=createRequire(path.join(root,'apps/web/package.json'))('sharp');
const originalPath=path.join(sourceDirectory,'cherry-valley-dawn-clean-plate.png');
const original=await sharp(originalPath).ensureAlpha().raw().toBuffer();
const reconstructionPath=path.join(sourceDirectory,'cherry-valley-reconstruction.png');
const reconstruction=await sharp(reconstructionPath).resize(1536,1024,{fit:'fill'}).ensureAlpha().raw().toBuffer();
// Only distal strands and silk enter these bounded extraction masks. Head,
// torso, hands, sword, legs and attachment roots retain original source pixels.
const hair='M1209 379C1245 383 1298 376 1314 400C1281 384 1248 391 1212 389ZM1216 394C1249 405 1290 407 1323 437C1291 417 1251 415 1221 405ZM1225 412C1252 427 1284 435 1284 455C1279 440 1250 436 1228 422Z';
const fabric='M1221 521C1264 530 1302 520 1334 505C1368 486 1396 478 1418 489L1433 506C1408 492 1387 494 1360 511C1311 544 1265 552 1230 537Z';
async function mask(d){return sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><path fill="white" d="'+d+'"/></svg>')).ensureAlpha().raw().toBuffer();}
const hairMask=await mask(hair),fabricMask=await mask(fabric);
const alpha=Buffer.alloc(1536*1024),rgba=Buffer.alloc(original.length),backdrop=Buffer.from(original);
for(let n=0;n<alpha.length;n++){
 const i=n*4;
 const luminance=.2126*original[i]+.7152*original[i+1]+.0722*original[i+2];
 const hairAlpha=hairMask[i+3]*Math.max(0,Math.min(1,(145-luminance)/40));
 alpha[n]=Math.round(Math.max(hairAlpha,fabricMask[i+3]));rgba[i+3]=alpha[n];
 for(let c=0;c<3;c++)rgba[i+c]=original[i+c];
}
// Extract only opaque interior locks/silk. Avoid broad chroma-key masks, which
// introduced holes and baked scenery in the rejected first atlas. Root edges
// stay pinned and surrounding stationary source pixels are untouched.
const under=alpha;
for(let n=0;n<alpha.length;n++){const a=under[n]/255,i=n*4;for(let c=0;c<3;c++)backdrop[i+c]=Math.round(original[i+c]*(1-a)+reconstruction[i+c]*a);}
const destination=path.join(root,'apps/web/public/assets/home/hero/cherry-valley-dawn-v2');
await fs.mkdir(destination,{recursive:true});
const entries=[];
async function save(name,pipeline,purpose){const bytes=await pipeline.toBuffer();await fs.writeFile(path.join(destination,name),bytes);const m=await sharp(bytes).metadata();entries.push({name,purpose,bytes:bytes.length,width:m.width,height:m.height,alpha:m.hasAlpha,sha256:createHash('sha256').update(bytes).digest('hex')});}
await save('backdrop-1280.webp',sharp(backdrop,{raw:{width:1536,height:1024,channels:4}}).resize(1280).webp({quality:78,effort:6}),'Original fixed body/scenery; generated underpainting only under distal hair/silk masks');
await save('hair-fabric-alpha.webp',sharp(rgba,{raw:{width:1536,height:1024,channels:4}}).extract({left:1196,top:372,width:244,height:184}).webp({quality:92,alphaQuality:100,effort:6}),'Three original-pixel hair locks and one opaque silk ribbon; independent pinned shader weights');
let scenery,sceneryQuality;
for(const quality of [65,60,55,50,45]){
 scenery=await sharp(path.join(sourceDirectory,'bamboo-valley-tall.png')).resize({width:1024,withoutEnlargement:true}).webp({quality,effort:6}).toBuffer();
 if(scenery.length<=220*1024){sceneryQuality=quality;break;}
}
if(scenery.length>220*1024)throw Error('Portrait scenery exceeds 220 KiB delivery ceiling');
await fs.writeFile(path.join(root,'apps/web/public/assets/home/scenery/bamboo-valley-tall-1024.webp'),scenery);
entries.push({name:'bamboo-valley-tall-1024.webp',purpose:'Single continuous portrait scenery; local surfaces supply text contrast',quality:sceneryQuality,bytes:scenery.length,width:1024,height:1536,sha256:createHash('sha256').update(scenery).digest('hex')});
const composite=await sharp(backdrop,{raw:{width:1536,height:1024,channels:4}}).composite([{input:await sharp(rgba,{raw:{width:1536,height:1024,channels:4}}).png().toBuffer()}]).png().toBuffer();
await sharp(composite).extract({left:1040,top:290,width:470,height:490}).resize(940).png().toFile(path.join(out,'masters/layer-rest-inspection.png'));
await sharp(rgba,{raw:{width:1536,height:1024,channels:4}}).extract({left:1196,top:372,width:244,height:184}).png().toFile(path.join(out,'masters/cutout-inspection.png'));
await fs.writeFile(path.join(out,'scene-export.json'),JSON.stringify({originalPath,reconstructionPath,originalHash:createHash('sha256').update(original).digest('hex'),artboard:[1536,1024],atlasBounds:[1196,372,244,184],masks:{hair,fabric},alphaRecipe:'bounded antialiased original-pixel interior locks and silk; reconstructed background only inside same mask; fixed body pixels excluded',entries},null,2));
console.log(JSON.stringify(entries));
