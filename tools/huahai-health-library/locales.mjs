import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const site = fileURLToPath(new URL('../../huahai-corporate-site/', import.meta.url))
const keys=['大健康知识库','知识库总览','农事上下五千年','药食同源（知识）','今日健康食谱','知识内容为中文原文。']
const rows={
 en:['Health Library','Library overview','Five millennia of farming','Food and medicinal ingredients','Today’s healthy menu','Knowledge articles are provided in the original Chinese.'],
 ar:['مكتبة الصحة','نظرة عامة','خمسة آلاف عام من الزراعة','الأغذية والمكونات الطبية','قائمة طعام صحية لليوم','المقالات المعرفية متاحة بنصها الصيني الأصلي.'],
 fr:['Bibliothèque santé','Vue d’ensemble','Cinq millénaires d’agriculture','Aliments et ingrédients médicinaux','Menu équilibré du jour','Les articles sont proposés dans leur version chinoise originale.'],
 de:['Gesundheitswissen','Übersicht','Fünf Jahrtausende Landwirtschaft','Lebensmittel und Heilpflanzen','Gesunder Tagesplan','Die Wissensartikel sind im chinesischen Original verfügbar.'],
 ja:['健康知識ライブラリ','ライブラリ概要','農業の五千年','食薬同源の知識','今日の健康献立','記事の本文は中国語の原文です。'],
 it:['Biblioteca salute','Panoramica','Cinque millenni di agricoltura','Alimenti e ingredienti medicinali','Menu equilibrato di oggi','Gli articoli sono disponibili nell’originale cinese.'],
 pt:['Biblioteca de saúde','Visão geral','Cinco milénios de agricultura','Alimentos e ingredientes medicinais','Menu saudável de hoje','Os artigos são apresentados no original chinês.'],
 es:['Biblioteca de salud','Vista general','Cinco milenios de agricultura','Alimentos e ingredientes medicinales','Menú saludable de hoy','Los artículos se ofrecen en su versión china original.'],
 'zh-TW':['大健康知識庫','知識庫總覽','農事上下五千年','藥食同源（知識）','今日健康食譜','知識內容為中文原文。']
}
const files=['health.html','agriculture.html','food-medicine.html','healthy-recipes.html']
for(const [code, values] of Object.entries(rows)) {
 const p=site+'assets/locales/'+code+'.json', dictionary=JSON.parse(fs.readFileSync(p,'utf8'))
 keys.forEach((key,i)=>dictionary[key]=values[i])
 for(const [i,file] of files.entries()) {
  const html=fs.readFileSync(site+file,'utf8'), title=html.match(/<title>(.*?)<\/title>/)[1], description=html.match(/<meta name="description" content="([^"]+)"/)[1]
  const label=values[[0,2,3,4][i]]
  dictionary[title]=label+' | Huahai Agri-Tech'
  dictionary[description]=`${label}. ${values[5]}`
 }
 fs.writeFileSync(p,JSON.stringify(dictionary,null,2)+'\n')
}
console.log('Nine language catalogs updated for the health library')
