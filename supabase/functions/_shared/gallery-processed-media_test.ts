import type { SupabaseClient } from "@supabase/supabase-js";
import { runGalleryModeration } from "./gallery-moderation-operation.ts";
import { signGalleryMedia } from "../../../packages/gallery-media/proof.ts";

const id="10000000-0000-4000-8000-000000000001";
const actor="10000000-0000-4000-8000-000000000002";
const owner="10000000-0000-4000-8000-000000000003";
const revision="10000000-0000-4000-8000-000000000004";
const secret="a".repeat(64); // Synthetic test key, never a provider credential.
const base64="UklGRl4AAABXRUJQVlA4WAoAAAAQAAAACwAABwAAQUxQSAoAAAABB1DAiAhERP8DVlA4IC4AAADQAQCdASoMAAgAAUAmJaACdLoB+AADsAD+4Ll/9zgewcewcfx1//JTX+NuOwAA";
const image={ base64, mime_type:"image/webp", size_bytes:atob(base64).length,width:12,height:8 };
function assert(value: unknown,message="assertion failed"): asserts value { if(!value) throw new Error(message); }
function same(actual:unknown,expected:unknown){ assert(JSON.stringify(actual)===JSON.stringify(expected),"unexpected categorical result"); }
type Body=ReturnType<typeof body>;
function body(){
  return {protocol:"gallery-media-v1",issued_at_ms:Date.now(),actor_id:actor,submission_id:id,action:"approved",
    reason:"",revision_id:revision,expected_thumbnail_revision_id:null,
    source:{storage_bucket:"member-gallery",storage_path:owner+"/original.png",mime_type:"image/png",
      size_bytes:999,etag:"1".repeat(32),sha256:"2".repeat(64)},full:{...image},thumbnail:{...image}};
}
async function request(value:Body, signature?:string){
  const raw=JSON.stringify(value);
  return new Request("https://gallery.example/moderate",{method:"POST",headers:{"content-type":"application/json",
    "x-mochirii-gallery-proof":signature??await signGalleryMedia(raw,secret)},body:raw});
}
function fixture(mode="success"){
  const uploads:string[]=[],removed:string[][]=[],rpcs:Record<string,unknown>[]=[];
  const current:Record<string,unknown>={id,user_id:owner,status:"pending",storage_bucket:"member-gallery",
    storage_path:owner+"/original.png",mime_type:"image/png",size_bytes:999,thumbnail_revision_id:null,
    thumbnail_storage_path:null,viewer_revision_id:null,viewer_storage_path:null};
  const client={
    from:()=>({select:()=>({eq:()=>({maybeSingle:()=>Promise.resolve({data:current,error:null})})})}),
    storage:{from:()=>({
      upload:async(path:string,_bytes:Uint8Array,options:Record<string,unknown>)=>{
        assert(options.upsert===false);uploads.push(path);
        return {error:mode==="partial"&&uploads.length===2?{message:"private-sentinel"}:null};
      },
      remove:async(paths:string[])=>{removed.push(paths);return {data:[],error:null};},
    })},
    rpc:async(name:string,args:Record<string,unknown>)=>{
      same(name,"gallery_commit_moderation");rpcs.push(args);
      if(mode==="lost")throw new Error("private-sentinel");
      if(mode==="network")return{data:null,error:{code:"",message:"private-sentinel"}};
      if(mode==="rollback")return{data:null,error:{code:"40001",message:"private-sentinel"}};
      if(mode==="conflict")return{data:{committed:false,reason:"source_changed"},error:null};
      return{data:{committed:true,submission:current},error:null};
    },
  };
  return {current,uploads,removed,rpcs,access:{adminClient:client as unknown as SupabaseClient,userId:actor}};
}
Deno.test("actual publication consumer binds full and thumbnail to one immutable atomic revision",async()=>{
  const f=fixture(); const result=await runGalleryModeration(await request(body()),f.access,secret);
  same(result.status,200);same(f.uploads.length,2);same(f.rpcs.length,1);same(f.removed.length,0);
  const rpc=f.rpcs[0];same(rpc.p_thumbnail_revision_id,revision);
  const media=rpc.p_media as Record<string,unknown>;
  same(media.viewer_storage_path,`_approved/full/${id}/${revision}.webp`);
  same(rpc.p_thumbnail_storage_path,`_approved/thumbs/${id}/${revision}.webp`);
  same(media.storage_path,owner+"/original.png");
});
Deno.test("partial writes and proven rollback remove only this attempt's unselected derivatives",async()=>{
  for(const mode of ["partial","rollback","conflict"]){
    const f=fixture(mode);const result=await runGalleryModeration(await request(body()),f.access,secret);
    assert(result.status>=400);same(f.removed.length,1);
    assert(f.removed[0].every(path=>path.startsWith("_approved/")&&path.includes(revision)));
    same(f.removed[0].length,mode==="partial"?1:2);
    assert(!(await result.text()).includes("private-sentinel"));
  }
});
Deno.test("unknown RPC completion retains every potentially published object and logs no raw failure",async()=>{
  for(const mode of ["lost","network"]){
    const f=fixture(mode);const result=await runGalleryModeration(await request(body()),f.access,secret);
    assert(result.status>=400);same(f.uploads.length,2);same(f.removed.length,0);
    assert(!(await result.text()).includes("private-sentinel"));
  }
});
Deno.test("invalid/expired/other-actor/modified media proofs do not touch Storage or RPC",async()=>{
  for(const change of [
    (v:Body)=>{v.actor_id=owner;},(v:Body)=>{v.issued_at_ms=Date.now()-121000;},
    (v:Body)=>{v.issued_at_ms=Date.now()+6000;},(v:Body)=>{v.source.size_bytes=104857601;},
    (v:Body)=>{v.full.width=2561;},(v:Body)=>{v.source.storage_path="../private-sentinel";},
  ]){
    const f=fixture();const value=body();change(value);
    const result=await runGalleryModeration(await request(value),f.access,secret);
    same(result.status,400);same(f.uploads.length,0);same(f.rpcs.length,0);
    assert(!(await result.text()).includes("private-sentinel"));
  }
  const f=fixture();same((await runGalleryModeration(await request(body(),"0".repeat(64)),f.access,secret)).status,400);
  same(f.uploads.length,0);
});
Deno.test("source races fail before write; a same-revision committed retry cannot create duplicate objects/audits",async()=>{
  const f=fixture();f.current.storage_path=owner+"/changed.png";
  same((await runGalleryModeration(await request(body()),f.access,secret)).status,409);same(f.uploads.length,0);
  const replay=fixture();replay.current.status="approved";replay.current.viewer_revision_id=revision;
  same((await runGalleryModeration(await request(body()),replay.access,secret)).status,200);
  same(replay.uploads.length,0);same(replay.rpcs.length,0);
});
Deno.test("rejection needs no processing key and writes no images",async()=>{
  const f=fixture();const value=body();value.action="rejected";
  const result=await runGalleryModeration(await request(value),f.access,"");
  same(result.status,200);same(f.uploads.length,0);same(f.rpcs[0].p_media,null);
});
