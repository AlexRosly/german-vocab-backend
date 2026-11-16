import { makeWordsDatabase } from "./words-database";
type Row=Record<string,any>;
export function makeCollocationsDatabase(){
 const base=makeWordsDatabase(),rows=new Map<string,Row>(),translations=new Map<string,Row>();let sequence=0;
 async function matches(row:Row,where:Row={}):Promise<boolean>{for(const [field,condition]of Object.entries(where)){
  if(field==="AND"){for(const part of Array.isArray(condition)?condition:[condition])if(!await matches(row,part))return false;}
  else if(field==="OR"){let found=false;for(const part of condition)if(await matches(row,part))found=true;if(!found)return false;}
  else if(field==="nounWord"||field==="verbWord"){if(!await base.db.word.findFirst({where:{AND:[{id:row[field+"Id"]},condition]}}))return false;}
  else if(condition&&typeof condition==="object"){
   for(const [operator,value]of Object.entries(condition)){
    if(operator==="not"){if(row[field]===value)return false;}
    else if(operator==="in"){if(!(value as unknown[]).includes(row[field]))return false;}
    else throw Error("Unsupported collocation filter "+operator);
   }
  }else if(row[field]!==condition)return false;
 }return true;}
 function project(row:Row|undefined,args:Row={}){
  if(!row)return null;if(args.select)return Object.fromEntries(Object.keys(args.select).map(key=>[key,row[key]]));
  const result=structuredClone(row);
  if(args.include?.translations)result.translations=[...translations.values()].filter(t=>t.collocationId===row.id).map(t=>structuredClone(t)).sort((a,b)=>a.language.localeCompare(b.language));
  for(const field of ["nounWord","verbWord"])if(args.include?.[field]){const word=base.words.get(row[field+"Id"]);result[field]=word?Object.fromEntries(Object.keys(args.include[field].select).map(key=>[key,word[key]])):null;}
  return result;
 }
 async function find(args:Row={}){const found:Row[]=[];for(const row of rows.values())if(await matches(row,args.where))found.push(row);return found;}
 const model={
  findFirst:jest.fn(async(args:Row)=>project((await find(args))[0],args)),
  findUnique:jest.fn(async(args:Row)=>project((await find(args))[0],args)),
  findMany:jest.fn(async(args:Row)=>{const found=await find(args);found.sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()||b.id.localeCompare(a.id));return found.slice(args.skip??0,args.take===undefined?undefined:(args.skip??0)+args.take).map(row=>project(row,args));}),
  count:jest.fn(async(args:Row)=>(await find(args)).length),
  create:jest.fn(async(args:Row)=>{const {translations:nested,...data}=args.data;const row={id:'coll-'+String(++sequence).padStart(4,'0'),createdAt:new Date(),updatedAt:new Date(),...data};rows.set(row.id,row);for(const entry of nested?.create??[])addTranslation({collocationId:row.id,...entry});return project(row,args);}),
  updateMany:jest.fn(async(args:Row)=>{let count=0;for(const row of await find(args)){Object.assign(row,structuredClone(args.data),{updatedAt:new Date()});count++;}return {count};}),
  deleteMany:jest.fn(async(args:Row)=>{let count=0;for(const row of await find(args)){rows.delete(row.id);for(const [id,translation]of translations)if(translation.collocationId===row.id)translations.delete(id);count++;}return {count};}),
 };
 function addTranslation(data:Row){const row={id:'ct-'+(++sequence),...data};translations.set(row.id,row);return row;}
 const originalTransaction=base.db.$transaction.getMockImplementation()!;
 const db={...base.db,wordCollocation:model,wordCollocationTranslation:{
  deleteMany:jest.fn(async({where}:Row)=>{let count=0;for(const [id,row]of translations)if(await matches(row,where)){translations.delete(id);count++;}return {count};}),
  createMany:jest.fn(async({data}:Row)=>{data.forEach(addTranslation);return {count:data.length};}),
 },$queryRaw:jest.fn(async()=>[{enabled:true}]),$transaction:jest.fn()};
 db.$transaction.mockImplementation(async(work:any,options:any)=>{const copies=[rows,translations].map(map=>structuredClone([...map]));try{return await originalTransaction(async()=>work(db),options)}catch(error){[rows,translations].forEach((map,i)=>{map.clear();for(const [key,value]of copies[i])map.set(key,value)});throw error}});
 return {...base,db,collocations:rows,collocationTranslations:translations};
}
