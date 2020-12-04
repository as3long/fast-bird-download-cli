const download = require('../src/download');
download(
    ['https://dldir1.qq.com/weixin/mac/WeChatMac.dmg'],
    './',
    {},
    10
).then((successList) => {
    console.log('download success: ', successList);
});
