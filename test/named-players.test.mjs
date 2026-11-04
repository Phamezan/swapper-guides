import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
import {parseTitle, championAliases, registryPlayer, validatePlayers} from '../scripts/harvest-vods.mjs';
const players=parse(await readFile(new URL('../vods/players.yml',import.meta.url),'utf8'));
const aliases=championAliases(JSON.parse(await readFile(new URL('../champions.json',import.meta.url))));
const channel={style:'named',patchStyle:'calendar',estimatePatch:true};
const calendar=[{patch:'26.16',start:'20260819'}];
test('curated registry is valid, aliases exact, multilingual and unambiguous',()=>{
 assert.equal(validatePlayers(players),players);
 assert.equal(registryPlayer('小超梦').name,'Xiao Chao Meng');
 assert.equal(registryPlayer('T1 페이커').name,'Faker');
 assert.equal(registryPlayer('NotBeifeng'),undefined);
 assert.equal(registryPlayer('Perfect KDA: 17/0/8'),undefined);
 assert.equal(registryPlayer('Faker vs Chovy'),undefined);
 assert.throws(()=>validatePlayers([...players,{...players[0],name:'Other',aliases:['Faker']}]),/Duplicate/);
});
test('real Beifeng and XiaoMing titles with exact-date patch estimation',()=>{
 for(const [title,player,champion,enemy,lane,region,rank] of [
 ['BeiFeng Qiyana vs Viktor — Challenger CN Super Server — Engsub','Beifeng','Qiyana','Viktor','mid',undefined,'Challenger'],
 ['🛑 XiaoMing 800 LP KR Aatrox vs. Vayne — Huge Comeback from Behind! Watch XiaoMing Turn It Around!','XiaoMing','Aatrox','Vayne','top','KR','Master+'],
 ['🛑 XiaoMing Aatrox vs. Heimerdinger — Playing for Gathering Storm! ⛈️','XiaoMing','Aatrox','Heimerdinger','top',undefined,'Master+']]) {
 const v=parseTitle(title,channel,aliases,'20260824',calendar);
 assert.deepEqual([v.player,v.champion,v.enemy,v.lane,v.region,v.rankClaim,v.patch,v.patchEstimated],[player,champion,enemy,lane,region,rank,'26.16',true]);
 }
});
test('named parser respects explicit lane, region, rank and patch',()=>{
 const v=parseTitle('Beifeng Qiyana Jungle vs Zed - NA Grandmaster Patch 25.1',channel,aliases);
 assert.deepEqual([v.lane,v.region,v.rankClaim,v.patch],['jungle','NA','Grandmaster','25.1']);
});
test('rejects incomplete, unknown, low-rank and edited named uploads',()=>{
 for(const title of ['🛑 XiaoMing Practicing Gangplank — Time to Sharpen My Skills!',
 'BeiFeng Qiyana vs Rank 1 Veigar (Xiuzhe) — Master CN Super Server — Engsub',
 'NotBeifeng Qiyana vs Zed','Beifeng Qiyana vs Unknown','Beifeng Qiyana vs Zed Diamond',
 ...['Montage','Highlights','compilation','Best of','Shorts'].map(x=>`Beifeng Qiyana vs Zed ${x}`)])
 assert.equal(parseTitle(title,channel,aliases,'20260824',calendar),null,title);
});

// XiaoMing listing curation is deliberately narrower than other replay sources.
test('XiaoMing duration boundaries and earliest normalized repeat',async()=>{
 const {listingDurationAllowed,selectVideos}=await import('../scripts/harvest-vods.mjs');
 const channel='UCBnsdnhdPysrE0JCjQPn-QA';
 for(const [durationSec,expected] of [[899,false],[900,true],[2700,true],[2701,false],[1200.5,false]])
  assert.equal(listingDurationAllowed({channel,durationSec}),expected);
 const base={channel,champion:'Aatrox',enemy:'Vayne',patch:'26.16',durationSec:1200};
 const older={...base,id:'old',title:'🛑 XiaoMing Aatrox vs. Vayne — Comeback!',uploadDate:'20260824',order:2};
 const newer={...base,id:'new',title:'XiaoMing Aatrox vs Vayne: Comeback',uploadDate:'20260825',durationSec:1205,order:1};
 assert.deepEqual(selectVideos([newer,older],new Set(['new'])).map(v=>v.id),['old']);
 assert.equal(selectVideos([older,{...newer,durationSec:1206}]).length,2);
 assert.equal(selectVideos([older,{...newer,enemy:'Riven'}]).length,2);
 assert.equal(selectVideos([older,{...newer,channel:'other'}]).length,2);
 assert.deepEqual(selectVideos([{...newer,uploadDate:'20260824'},older]).map(v=>v.id),['old']);
});

test('named funny and edited markers are case insensitive',()=>{
 for(const marker of ['fUnNy','MONTAGE','Highlights','Compilation','BEST OF','shorts'])
  assert.equal(parseTitle(`XiaoMing Aatrox vs. Vayne — ${marker}`,channel,aliases,'20260824',calendar),null);
});

test('real XiaoMing listing fixtures include accepted matchups and rejected uploads',async()=>{
 const {listingDurationAllowed}=await import('../scripts/harvest-vods.mjs');
 const fixtures=JSON.parse(await readFile(new URL('./fixtures/xiaoming-titles.json',import.meta.url)));
 for(const row of fixtures) assert.equal(listingDurationAllowed(row)&&!!parseTitle(row.title,{...channel,id:row.channel},aliases,'20260824',calendar),row.accepted,row.title);
 const prose=parseTitle("XiaoMing Aatrox vs. K'Sante — Give Me One Opening and I’ll SMASH You!",{...channel,id:fixtures[0].channel},aliases,'20260824',calendar);
 assert.equal(prose.player,'XiaoMing');
});
