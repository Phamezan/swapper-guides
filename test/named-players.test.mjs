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
