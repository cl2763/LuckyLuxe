const cards = require('./cards')
const values = key => ['不限'].concat([...new Set(cards.map(c => c[key]))])
function filterCards(filters) {
 const match = (c, key) => !filters[key] || filters[key] === '不限' || c[key] === filters[key]
 let found = cards.filter(c => match(c,'length') && match(c,'shot') && match(c,'style'))
 let message = ''
 if (!found.length) { found=cards.filter(c=>match(c,'length')&&match(c,'shot')); if(found.length) message='这个组合暂无卡片，已为你放宽风格筛选。' }
 if (!found.length) { found=cards.filter(c=>match(c,'shot')); message='换个组合试试，先看看相同拍法的姿势。' }
 return { groups: ['A','B','C','D','E'].map(group=>({id:group,cards:found.filter(c=>c.grp===group)})).filter(g=>g.cards.length), count:found.length, message }
}
module.exports={cards,values,filterCards,find:id=>cards.find(c=>c.id===id)}
