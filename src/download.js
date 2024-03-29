/*!
 * @author liyuelong1020@gmail.com
 * @date 2019/11/30 030
 * @description Description
 */
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const chalk = require('chalk')
const fse = require('fs-extra')
const taskSlice = require('./taskSlice')
const ora = require('ora')
const progress = require('progress-stream');

const spinner = ora(`downloading...\n`)

// 获取文件大小字符串
function getFileSizeStr(length) {
    let size = Number(length)
    let unit = 'B'
    if (size > 1000) {
        size /= 1024
        unit = 'KB'
    }
    if (size > 1000) {
        size /= 1024
        unit = 'MB'
    }
    if (size > 1000) {
        size /= 1024
        unit = 'GB'
    }
    if (size > 1000) {
        size /= 1024
        unit = 'TB'
    }
    return size.toFixed(2) + unit
}

function formatHeaders (headers) {
    return Object.keys(headers).reduce((header, name) => {
        header[String(name).toLowerCase()] = headers[name]
        return header
    }, {})
}

// 获取不重复的名字
function getName(downloadDir, name) {
    name = decodeURIComponent(name)
    let nameArr = name.split('.')
    let ext = nameArr.pop()
    let oldName = nameArr.join('.')
    let fileName = oldName
    let index = 0
    while (true) {
        try {
            fs.accessSync(path.join(downloadDir, fileName + '.' + ext), fs.constants.F_OK)
            index++
            fileName = `${oldName} (${index})`
        } catch (err) {
            return [fileName, ext].join('.')
        }
    }
}

// 文件分片
function splitBlock(blockSize, fileLength) {
    let blockList = []
    let block = 0
    while (block < fileLength) {
        let end = block + blockSize - 1
        if (end > fileLength) {
            end = fileLength
        }
        blockList.push({start: block, end: end})
        block += blockSize
    }
    return blockList
}

// 获取请求头
async function getResHeader(url, defaultHeaders, retryCount) {
    let headers = Object.assign({
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache',
        'Range': 'bytes=0-1'
    }, defaultHeaders)

    try {
        let response = await axios({
            timeout: 60000,
            method: 'get',
            url,
            headers
        })
        return formatHeaders(response.headers)
    } catch (e) {
        retryCount -= 1
        if (retryCount > 0) {
            return getResHeader(url, defaultHeaders, retryCount)
        } else {
            throw e
        }
    }
}

// 下载
async function download(url, tempPath, defaultHeaders, retryCount, start = 0, end, cb = ({transferred}) => {console.log(transferred)}) {
    let headers = Object.assign({
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache'
    }, defaultHeaders)

    try {
        let response = await axios({
            timeout: 60000,
            method: 'get',
            responseType: 'stream',
            url,
            headers,
        })
        let responseHeaders = formatHeaders(response.headers)
        let fileLength = Number(responseHeaders['content-length'])

        var str = progress({
            length: end-start,
            time: 100 /* ms */
        });

        str.on('progress', cb);

        return new Promise((resolve, reject) => {
            let readerStream = response.data.pipe(str).pipe(fs.createWriteStream(tempPath, {start: 0, flags: 'r+', autoClose: true}))
            // 等待5分钟还没下载完成则中断下载
            let timer
            let setTimer = () => {
                if (timer) {
                    clearTimeout(timer)
                }
                timer = setTimeout(() => {
                    readerStream.end()
                    reject(new Error('download fail'))
                }, 300000)
            }
            setTimer()

            readerStream.on('finish', () => {
                clearTimeout(timer)
                timer = null

                if (fileLength === readerStream.bytesWritten) {
                    resolve()
                } else {
                    throw new Error('file length error')
                }
            })
            readerStream.on('error', (err) => {
                clearTimeout(timer)
                timer = null

                reject(err)
            })
            readerStream.on('drain', () => {
                setTimer()
            })
        })
    } catch (e) {
        retryCount -= 1
        if (retryCount > 0) {
            return download(url, tempPath, defaultHeaders, retryCount, start, end, cb)
        } else {
            throw e
        }
    }
}

// 分段下载
async function multiThreadDownload (blockList, url, fileName, filePath, defaultHeaders, headers, retryCount, fileTotalLength) {
    // 生成临时文件目录
    let downloadList = blockList.map(({start, end}) => {
        let tempPath = path.join(filePath, '../.download_cache/' + fileName + '/' )
        let tempFilePath = path.join(tempPath, start + '-' + end + '.tmp')

        return {
            start,
            end,
            tempPath,
            tempFilePath
        }
    })

    // 已下载的文件大小
    let downloadedSize = 0

    await taskSlice(downloadList, 32, async ({start, end, tempFilePath, tempPath}) => {
        // 创建临时文件
        fse.ensureDirSync(tempPath);
        // 判断临时文件是否存在
        if (fs.existsSync(tempFilePath)) {
            let fileLength = await new Promise((resolve, reject) => {
                fs.readFile(tempFilePath, (err, data) => {
                    if (err) {
                        reject(err)
                    }
                    resolve(data.length)
                })
            })
            if (fileLength >= end - start) {
                // downloadedSize++
                downloadedSize += fileLength;
                return Promise.resolve()
            }
        }
        fs.appendFileSync(tempFilePath, new Uint8Array(0))

        try {
            let header = Object.assign({}, defaultHeaders, {
                'etag': headers['etag']|| '',
                'Content-Type': headers['content-type'],
                'Range': 'bytes=' + start + '-' + end
            })
            let lastLoaded = 0;
            await download(url, tempFilePath, header, retryCount, start, end, ({transferred}) => {
                // downloadedSize
                let diffLoaded = transferred - lastLoaded;
                lastLoaded = transferred;
                downloadedSize += diffLoaded;
                spinner.text = 'download ' + chalk.yellow(fileName) + '  ' + chalk.green(Math.floor(downloadedSize / fileTotalLength * 100) + '%') + '  '  + chalk.green(getFileSizeStr(downloadedSize)) + '\n';
            })

            // downloadedSize++
            spinner.text = 'download ' + chalk.yellow(fileName) + '  ' + chalk.green(Math.floor(downloadedSize / fileTotalLength * 100) + '%') + '  '  + chalk.green(getFileSizeStr(downloadedSize)) + '\n';
        } catch (e) {
            fse.removeSync(tempFilePath)
            throw e
        }
    })

    let writeStream = fs.createWriteStream(filePath)

    for (let i = 0; i < downloadList.length; i++) {
        let tempFilePath = downloadList[i].tempFilePath
        await new Promise((resolve, reject) => {
            let readerStream = fs.createReadStream(tempFilePath)
            readerStream.pipe(writeStream, {end: false})

            readerStream.on('end', () => {
                resolve()
            })
            readerStream.on('error', (err) => {
                reject(err)
            })
        })
    }
    writeStream.end('down')
    fse.removeSync(downloadList[0].tempPath)
}

// 批量下载
async function sendRequest(url, downloadDir, defaultHeaders, retryCount, count) {
    let headers = await getResHeader(url, defaultHeaders, retryCount)
    let fileName = getName(downloadDir, url.split('?')[0].split('/').pop())
    let filePath = path.join(downloadDir, fileName)
    let blockList = null
    // 分块大小 4M
    let blockSize = 1024 * 1024 * 4;
    let fileLength = 0

    if (headers && headers['content-range']) {
        fileLength = Number(headers['content-range'].split('/').pop())

        blockSize = Math.ceil(fileLength / count);

        if (fileLength > blockSize) {
            blockList = splitBlock(blockSize, fileLength)
        }
    }

    if (!Array.isArray(blockList) || !blockList.length) {
        blockList = [{start: 0, end: fileLength}]
    }

    console.log(chalk.green(fileName + ' downloading ') + fileLength + '(' + getFileSizeStr(fileLength) + ')\n')
    try {
        // 分段下载
        await multiThreadDownload(blockList, url, fileName, filePath, defaultHeaders, headers, retryCount, fileLength)

        console.log(chalk.cyan(fileName + ' download success\n'))
    } catch (e) {
        console.log(chalk.red(fileName + ' download fail\n'))

        throw e
    }
}

module.exports = async function downloadResource(urlList, downloadDir = './download', retryCount = 10, count = 10) {
    if (!urlList || !urlList.length) {
        return []
    }
    let successList = []

    spinner.start()

    count = count < 1 ? 1 : (count > 256 ? 256 : count)

    await taskSlice(urlList, 1, async (url) => {
        return sendRequest(url, downloadDir, {}, retryCount, count).then(() => {
            successList.push(url)
        }).catch(e => {
            console.log(e && e.stack || e)
        })
    })
    spinner.stop()

    return successList
}
