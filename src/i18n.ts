// Screen text in several languages. English is the source; a missing translation falls back to English.
// The Hausa, Yoruba, Igbo and Pidgin texts were written by an AI and have NOT been checked by native speakers:
// treat them as a first draft and correct them in this file (one line per phrase).
import { config } from './config';

export type Lang = 'en' | 'ha' | 'yo' | 'ig' | 'pcm';
export const LANGUAGES: Record<Lang, string> = { en: 'English', ha: 'Hausa', yo: 'Yorùbá', ig: 'Igbo', pcm: 'Naijá (Pidgin)' };

const en = {
  // tabs and header
  'nav.sell': 'Sell', 'nav.products': 'Products', 'nav.purchases': 'Purchases', 'nav.transfers': 'Transfers', 'nav.sales': 'Sales', 'nav.reports': 'Reports', 'nav.settings': 'Settings',
  'status.online': 'Online', 'status.offline': 'Offline', 'status.signOut': 'Sign out', 'status.localOnly': 'Local only', 'status.syncProblem': 'Sync problem',
  'status.notSynced': 'Not synced yet', 'status.synced': 'Synced {time}', 'status.waiting': '{n} waiting',
  // sell screen
  'pos.search': 'Search or scan barcode…', 'pos.noProducts': 'No products yet. Add some in Products, or load demo data in Settings.', 'pos.inStock': '{n} in stock',
  'pos.cart': 'Cart', 'pos.tapToAdd': 'Tap a product to add it.', 'pos.each': '{price} each', 'pos.customer': 'Customer (optional)', 'pos.total': 'Total',
  'pos.charge': 'Charge {amount}', 'pos.clear': 'Clear cart', 'pos.expired': 'Expired stock',
  'pay.cash': 'Cash', 'pay.transfer': 'Transfer', 'pay.pos': 'POS', 'pay.card': 'Card', 'pay.credit': 'Credit',
  'receipt.print': 'Print', 'receipt.printReceipt': 'Print receipt', 'receipt.done': 'Done',
  // sign in
  'login.firstTime': 'First time here: create the owner (admin) account.', 'login.signInToContinue': 'Sign in to continue.', 'login.username': 'Username', 'login.password': 'Password',
  'login.atLeast8': '(at least 8 characters)', 'login.create': 'Create admin account', 'login.signIn': 'Sign in', 'login.server': 'Server address', 'login.useServer': 'Use this server',
  'login.thisWebsite': 'This website', 'login.noServer': 'Work without a server',
  // products
  'products.add': 'Add product', 'products.name': 'Name *', 'products.sku': 'SKU / barcode', 'products.price': 'Selling price *', 'products.cost': 'Cost price', 'products.unit': 'Unit (bag, bottle…)',
  'products.opening': 'Opening stock', 'products.low': 'Low-stock alert at', 'products.product': 'Product', 'products.priceCol': 'Price', 'products.stock': 'Stock', 'products.adjust': 'Adjust stock',
  // reports
  'reports.thisShop': 'This shop', 'reports.allShops': 'All shops', 'reports.today': 'Today', 'reports.last7': 'Last 7 days', 'reports.last30': 'Last 30 days', 'reports.sales': '{n} sales',
  'reports.top': 'Top sellers today', 'reports.noSales': 'No sales yet today.', 'reports.low': 'Running low', 'reports.healthy': 'All stock levels are healthy.', 'reports.left': '{n} left',
  'reports.expiry': 'Expiry', 'reports.expiryNone': 'Nothing expired or expiring soon.', 'reports.expiredOn': 'expired {date}', 'reports.expiresOn': 'expires {date}', 'reports.loading': 'Loading…',
  // settings
  'settings.language': 'Language',
  'biz.title': 'Businesses', 'biz.help': 'Each business has its own people, products and sales. Nobody can see another business.', 'biz.created': '{name} was created.', 'biz.people': '{n} people', 'biz.name': 'Business name', 'biz.adminUser': 'Its admin username', 'biz.adminPass': 'Its admin password (8+)', 'biz.add': 'Add business', 'lot.batch': 'Batch no. (optional)', 'lot.expiry': 'Expiry date (optional)',
  'lot.add': 'Add a batch with an expiry date', 'lot.save': 'Save batch',
} as const;

export type Key = keyof typeof en;
type Dict = Record<Key, string>;

const ha: Dict = {
  'nav.sell': 'Sayarwa', 'nav.products': 'Kaya', 'nav.purchases': 'Sayayya', 'nav.transfers': 'Mika kaya', 'nav.sales': 'Tallace-tallace', 'nav.reports': 'Rahotanni', 'nav.settings': 'Saituna',
  'status.online': 'Akwai intanet', 'status.offline': 'Babu intanet', 'status.signOut': 'Fita', 'status.localOnly': 'A wannan na\'ura kawai', 'status.syncProblem': 'Matsalar aiki tare',
  'status.notSynced': 'Ba a yi aiki tare ba tukuna', 'status.synced': 'An yi aiki tare {time}', 'status.waiting': '{n} suna jira',
  'pos.search': 'Nemo ko duba lambar kaya…', 'pos.noProducts': 'Babu kaya tukuna. Ƙara a Kaya, ko a ɗora bayanan gwaji a Saituna.', 'pos.inStock': '{n} a ajiya',
  'pos.cart': 'Kwando', 'pos.tapToAdd': 'Danna kaya don ƙarawa.', 'pos.each': '{price} kowanne', 'pos.customer': 'Abokin ciniki (zaɓi)', 'pos.total': 'Jimla',
  'pos.charge': 'Karɓi {amount}', 'pos.clear': 'Share kwando', 'pos.expired': 'Kayan da suka ƙare lokaci',
  'pay.cash': 'Kuɗi hannu', 'pay.transfer': 'Aikawa banki', 'pay.pos': 'POS', 'pay.card': 'Kati', 'pay.credit': 'Bashi',
  'receipt.print': 'Buga', 'receipt.printReceipt': 'Buga rasit', 'receipt.done': 'An gama',
  'login.firstTime': 'Farko: ƙirƙiri asusun mai shago (admin).', 'login.signInToContinue': 'Shiga don ci gaba.', 'login.username': 'Sunan mai amfani', 'login.password': 'Kalmar sirri',
  'login.atLeast8': '(akalla haruffa 8)', 'login.create': 'Ƙirƙiri asusun admin', 'login.signIn': 'Shiga', 'login.server': 'Adireshin sabar', 'login.useServer': 'Yi amfani da wannan sabar',
  'login.thisWebsite': 'Wannan shafin', 'login.noServer': 'Yi aiki ba tare da sabar ba',
  'products.add': 'Ƙara kaya', 'products.name': 'Suna *', 'products.sku': 'Lambar kaya / barcode', 'products.price': 'Farashin sayarwa *', 'products.cost': 'Farashin sayowa', 'products.unit': 'Ma\'auni (buhu, kwalba…)',
  'products.opening': 'Kayan farko', 'products.low': 'Faɗakarwa idan ya yi kaɗan', 'products.product': 'Kaya', 'products.priceCol': 'Farashi', 'products.stock': 'Ajiya', 'products.adjust': 'Gyara ajiya',
  'reports.thisShop': 'Wannan shagon', 'reports.allShops': 'Dukkan shaguna', 'reports.today': 'Yau', 'reports.last7': 'Kwanaki 7 da suka wuce', 'reports.last30': 'Kwanaki 30 da suka wuce', 'reports.sales': 'Tallace-tallace: {n}',
  'reports.top': 'Mafi sayuwa yau', 'reports.noSales': 'Babu tallace-tallace yau tukuna.', 'reports.low': 'Ya yi kaɗan', 'reports.healthy': 'Duk ajiya na da kyau.', 'reports.left': '{n} ya rage',
  'reports.expiry': 'Ƙarewar lokaci', 'reports.expiryNone': 'Babu abin da ya ƙare ko zai ƙare nan kusa.', 'reports.expiredOn': 'ya ƙare {date}', 'reports.expiresOn': 'zai ƙare {date}', 'reports.loading': 'Ana ɗauka…',
  'settings.language': 'Harshe',
  'biz.title': 'Kasuwanci', 'biz.help': 'Kowane kasuwanci yana da mutanensa, kayansa da tallace-tallacensa. Babu wanda zai iya ganin na wani.', 'biz.created': 'An ƙirƙiri {name}.', 'biz.people': 'Mutane {n}', 'biz.name': 'Sunan kasuwanci', 'biz.adminUser': 'Sunan mai amfani na admin ɗinsa', 'biz.adminPass': 'Kalmar sirrin admin ɗinsa (8+)', 'biz.add': 'Ƙara kasuwanci', 'lot.batch': 'Lambar rukuni (zaɓi)', 'lot.expiry': 'Ranar ƙarewa (zaɓi)',
  'lot.add': 'Ƙara rukunin kaya mai ranar ƙarewa', 'lot.save': 'Ajiye rukuni',
};

const yo: Dict = {
  'nav.sell': 'Tà', 'nav.products': 'Àwọn ọjà', 'nav.purchases': 'Ríra ọjà', 'nav.transfers': 'Gbigbe ọjà', 'nav.sales': 'Títà', 'nav.reports': 'Ìròyìn', 'nav.settings': 'Ètò',
  'status.online': 'Lórí ayélujára', 'status.offline': 'Kò sí ayélujára', 'status.signOut': 'Jáde', 'status.localOnly': 'Lórí ẹ̀rọ yìí nìkan', 'status.syncProblem': 'Ìṣòro ìmúṣọ̀kan',
  'status.notSynced': 'A kò tíì múṣọ̀kan', 'status.synced': 'A múṣọ̀kan {time}', 'status.waiting': '{n} ń dúró',
  'pos.search': 'Wá tàbí ṣàyẹ̀wò kóòdù ọjà…', 'pos.noProducts': 'Kò sí ọjà síbẹ̀. Fi kún un ní Àwọn ọjà, tàbí gbé àpẹẹrẹ jáde ní Ètò.', 'pos.inStock': '{n} wà ní ìpamọ́',
  'pos.cart': 'Agbọ̀n', 'pos.tapToAdd': 'Tẹ ọjà láti fi kún un.', 'pos.each': '{price} ọ̀kọ̀ọ̀kan', 'pos.customer': 'Oníbàárà (àṣàyàn)', 'pos.total': 'Àpapọ̀',
  'pos.charge': 'Gbà {amount}', 'pos.clear': 'Sọ agbọ̀n di òfo', 'pos.expired': 'Ọjà tó ti parí àkókò',
  'pay.cash': 'Owó ọwọ́', 'pay.transfer': 'Ìfiránṣẹ́ owó', 'pay.pos': 'POS', 'pay.card': 'Káàdì', 'pay.credit': 'Gbèsè',
  'receipt.print': 'Tẹ̀jáde', 'receipt.printReceipt': 'Tẹ̀ ìwé ẹ̀rí owó jáde', 'receipt.done': 'Parí',
  'login.firstTime': 'Ìgbà àkọ́kọ́: ṣẹ̀dá àkọọ́lẹ̀ olóòtù (admin).', 'login.signInToContinue': 'Wọlé láti tẹ̀síwájú.', 'login.username': 'Orúkọ olùlò', 'login.password': 'Ọ̀rọ̀ aṣínà',
  'login.atLeast8': '(kò gbọdọ̀ dín ní ọ̀rọ̀ 8)', 'login.create': 'Ṣẹ̀dá àkọọ́lẹ̀ admin', 'login.signIn': 'Wọlé', 'login.server': 'Àdírẹ́sì sáfà', 'login.useServer': 'Lo sáfà yìí',
  'login.thisWebsite': 'Ojú òpó yìí', 'login.noServer': 'Ṣiṣẹ́ láìsí sáfà',
  'products.add': 'Fi ọjà kún un', 'products.name': 'Orúkọ *', 'products.sku': 'Kóòdù ọjà / barcode', 'products.price': 'Owó títà *', 'products.cost': 'Owó ríra', 'products.unit': 'Ìwọ̀n (àpò, ìgò…)',
  'products.opening': 'Ọjà ìbẹ̀rẹ̀', 'products.low': 'Ìkìlọ̀ nígbà tó bá dín sí', 'products.product': 'Ọjà', 'products.priceCol': 'Owó', 'products.stock': 'Ìpamọ́', 'products.adjust': 'Ṣàtúnṣe ìpamọ́',
  'reports.thisShop': 'Ṣọ́ọ̀bù yìí', 'reports.allShops': 'Gbogbo ṣọ́ọ̀bù', 'reports.today': 'Òní', 'reports.last7': 'Ọjọ́ 7 sẹ́yìn', 'reports.last30': 'Ọjọ́ 30 sẹ́yìn', 'reports.sales': 'Títà: {n}',
  'reports.top': 'Ọjà tó tà jù lónìí', 'reports.noSales': 'Kò tíì sí títà lónìí.', 'reports.low': 'Ó ń dín kù', 'reports.healthy': 'Ìpamọ́ gbogbo dára.', 'reports.left': '{n} ló kù',
  'reports.expiry': 'Ìparí àkókò', 'reports.expiryNone': 'Kò sí ohun tó ti parí tàbí tó ń parí láìpẹ́.', 'reports.expiredOn': 'ó parí {date}', 'reports.expiresOn': 'yóò parí {date}', 'reports.loading': 'Ó ń gbé jáde…',
  'settings.language': 'Èdè',
  'biz.title': 'Àwọn iṣẹ́ òwò', 'biz.help': 'Iṣẹ́ òwò kọ̀ọ̀kan ní àwọn ènìyàn, ọjà àti títà tirẹ̀. Ẹnìkan kò lè rí ti ẹlòmíràn.', 'biz.created': 'A ti ṣẹ̀dá {name}.', 'biz.people': 'Ènìyàn {n}', 'biz.name': 'Orúkọ iṣẹ́ òwò', 'biz.adminUser': 'Orúkọ olùlò admin rẹ̀', 'biz.adminPass': 'Ọ̀rọ̀ aṣínà admin rẹ̀ (8+)', 'biz.add': 'Fi iṣẹ́ òwò kún', 'lot.batch': 'Nọ́mbà ẹgbẹ́ (àṣàyàn)', 'lot.expiry': 'Ọjọ́ ìparí (àṣàyàn)',
  'lot.add': 'Fi ẹgbẹ́ ọjà kún pẹ̀lú ọjọ́ ìparí', 'lot.save': 'Fi ẹgbẹ́ pamọ́',
};

const ig: Dict = {
  'nav.sell': 'Ree ahịa', 'nav.products': 'Ngwa ahịa', 'nav.purchases': 'Ịzụta', 'nav.transfers': 'Mbufe ngwa', 'nav.sales': 'Ire ahịa', 'nav.reports': 'Akụkọ', 'nav.settings': 'Ntọala',
  'status.online': 'Ịntanet dị', 'status.offline': 'Ịntanet adịghị', 'status.signOut': 'Pụọ', 'status.localOnly': 'Naanị n\'ọkụ a', 'status.syncProblem': 'Nsogbu njikọ',
  'status.notSynced': 'Ejikọbeghị ya', 'status.synced': 'Ejikọrọ {time}', 'status.waiting': '{n} na-eche',
  'pos.search': 'Chọọ ma ọ bụ nyochaa koodu ngwa…', 'pos.noProducts': 'Enwebeghị ngwa. Tinye ụfọdụ na Ngwa ahịa, ma ọ bụ bulite ihe nlele na Ntọala.', 'pos.inStock': '{n} dị n\'ụlọ',
  'pos.cart': 'Nkata', 'pos.tapToAdd': 'Pịa ngwa ka itinye ya.', 'pos.each': '{price} nke ọ bụla', 'pos.customer': 'Onye na-azụ (nhọrọ)', 'pos.total': 'Ngụkọta',
  'pos.charge': 'Nata {amount}', 'pos.clear': 'Kpochapụ nkata', 'pos.expired': 'Ngwa gafere oge',
  'pay.cash': 'Ego aka', 'pay.transfer': 'Mbufe ego', 'pay.pos': 'POS', 'pay.card': 'Kaadị', 'pay.credit': 'Ụgwọ',
  'receipt.print': 'Bipụta', 'receipt.printReceipt': 'Bipụta risịtị', 'receipt.done': 'Emechala',
  'login.firstTime': 'Nke mbụ: mepụta akaụntụ onye nwe ụlọ ahịa (admin).', 'login.signInToContinue': 'Banye ka ị gaa n\'ihu.', 'login.username': 'Aha onye ọrụ', 'login.password': 'Okwuntughe',
  'login.atLeast8': '(opekata mpe mkpụrụedemede 8)', 'login.create': 'Mepụta akaụntụ admin', 'login.signIn': 'Banye', 'login.server': 'Adreesị sava', 'login.useServer': 'Jiri sava a',
  'login.thisWebsite': 'Weebụsaịtị a', 'login.noServer': 'Rụọ ọrụ n\'enweghị sava',
  'products.add': 'Tinye ngwa', 'products.name': 'Aha *', 'products.sku': 'Koodu ngwa / barcode', 'products.price': 'Ọnụ ahịa ire *', 'products.cost': 'Ọnụ ahịa ịzụta', 'products.unit': 'Nha (akpa, karama…)',
  'products.opening': 'Ngwa mbido', 'products.low': 'Ọkwa mgbe o fọrọ ntakịrị', 'products.product': 'Ngwa', 'products.priceCol': 'Ọnụ ahịa', 'products.stock': 'Nchekwa', 'products.adjust': 'Gbanwee nchekwa',
  'reports.thisShop': 'Ụlọ ahịa a', 'reports.allShops': 'Ụlọ ahịa niile', 'reports.today': 'Taa', 'reports.last7': 'Ụbọchị 7 gara aga', 'reports.last30': 'Ụbọchị 30 gara aga', 'reports.sales': 'Ire ahịa: {n}',
  'reports.top': 'Ndị rere kacha taa', 'reports.noSales': 'Enwebeghị ire ahịa taa.', 'reports.low': 'Na-agwụ', 'reports.healthy': 'Nchekwa niile dị mma.', 'reports.left': '{n} fọdụrụ',
  'reports.expiry': 'Njedebe oge', 'reports.expiryNone': 'Enweghị ihe gafere oge ma ọ bụ nke na-abịa ọsọ ọsọ.', 'reports.expiredOn': 'gafere {date}', 'reports.expiresOn': 'ga-agafe {date}', 'reports.loading': 'Na-ebu…',
  'settings.language': 'Asụsụ',
  'biz.title': 'Azụmahịa', 'biz.help': 'Azụmahịa ọ bụla nwere ndị ya, ngwaahịa ya na ire ya. Ọ nweghị onye pụrụ ịhụ nke onye ọzọ.', 'biz.created': 'Emepụtara {name}.', 'biz.people': 'Mmadụ {n}', 'biz.name': 'Aha azụmahịa', 'biz.adminUser': 'Aha onye ọrụ admin ya', 'biz.adminPass': 'Okwuntughe admin ya (8+)', 'biz.add': 'Tinye azụmahịa', 'lot.batch': 'Nọmba otu (nhọrọ)', 'lot.expiry': 'Ụbọchị ọ ga-agwụ (nhọrọ)',
  'lot.add': 'Tinye otu ngwaahịa nwere ụbọchị ọ ga-agwụ', 'lot.save': 'Chekwaa otu',
};

const pcm: Dict = {
  'nav.sell': 'Sell', 'nav.products': 'Goods', 'nav.purchases': 'Wetin I buy', 'nav.transfers': 'Move goods', 'nav.sales': 'Sales', 'nav.reports': 'Reports', 'nav.settings': 'Settings',
  'status.online': 'Network dey', 'status.offline': 'No network', 'status.signOut': 'Comot', 'status.localOnly': 'For dis phone only', 'status.syncProblem': 'Sync wahala',
  'status.notSynced': 'E never sync', 'status.synced': 'E don sync {time}', 'status.waiting': '{n} dey wait',
  'pos.search': 'Search or scan barcode…', 'pos.noProducts': 'No goods yet. Add some for Goods, or load demo data for Settings.', 'pos.inStock': '{n} dey for shop',
  'pos.cart': 'Basket', 'pos.tapToAdd': 'Press goods to add am.', 'pos.each': '{price} each', 'pos.customer': 'Customer (if you want)', 'pos.total': 'Total',
  'pos.charge': 'Collect {amount}', 'pos.clear': 'Empty basket', 'pos.expired': 'Goods wey don expire',
  'pay.cash': 'Cash', 'pay.transfer': 'Transfer', 'pay.pos': 'POS', 'pay.card': 'Card', 'pay.credit': 'Credit',
  'receipt.print': 'Print', 'receipt.printReceipt': 'Print receipt', 'receipt.done': 'Done',
  'login.firstTime': 'First time: create di owner (admin) account.', 'login.signInToContinue': 'Sign in to continue.', 'login.username': 'Username', 'login.password': 'Password',
  'login.atLeast8': '(at least 8 letters)', 'login.create': 'Create admin account', 'login.signIn': 'Sign in', 'login.server': 'Server address', 'login.useServer': 'Use dis server',
  'login.thisWebsite': 'Dis website', 'login.noServer': 'Work without server',
  'products.add': 'Add goods', 'products.name': 'Name *', 'products.sku': 'SKU / barcode', 'products.price': 'Selling price *', 'products.cost': 'Cost price', 'products.unit': 'Unit (bag, bottle…)',
  'products.opening': 'Starting stock', 'products.low': 'Warn me when e remain', 'products.product': 'Goods', 'products.priceCol': 'Price', 'products.stock': 'Stock', 'products.adjust': 'Change stock',
  'reports.thisShop': 'Dis shop', 'reports.allShops': 'All shops', 'reports.today': 'Today', 'reports.last7': 'Last 7 days', 'reports.last30': 'Last 30 days', 'reports.sales': '{n} sales',
  'reports.top': 'Wetin sell pass today', 'reports.noSales': 'No sales yet today.', 'reports.low': 'Dem dey finish', 'reports.healthy': 'All stock dey okay.', 'reports.left': '{n} remain',
  'reports.expiry': 'Expiry', 'reports.expiryNone': 'Nothing don expire or wan expire soon.', 'reports.expiredOn': 'e expire {date}', 'reports.expiresOn': 'e go expire {date}', 'reports.loading': 'E dey load…',
  'settings.language': 'Language',
  'biz.title': 'Businesses', 'biz.help': 'Each business get im own people, goods and sales. Nobody fit see anoda business own.', 'biz.created': '{name} don create.', 'biz.people': '{n} people', 'biz.name': 'Business name', 'biz.adminUser': 'Im admin username', 'biz.adminPass': 'Im admin password (8+)', 'biz.add': 'Add business', 'lot.batch': 'Batch number (if you want)', 'lot.expiry': 'Expiry date (if you want)',
  'lot.add': 'Add batch wey get expiry date', 'lot.save': 'Save batch',
};

export const DICTIONARIES: Record<Lang, Partial<Dict>> = { en, ha, yo, ig, pcm };

/** Translates a key into the chosen language ({name} placeholders are filled from `vars`). */
export function t(key: Key, vars?: Record<string, string | number>, lang: string = config.language): string {
  const dict = DICTIONARIES[lang as Lang] ?? en;
  let s: string = dict[key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
