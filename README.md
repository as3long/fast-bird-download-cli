# fast-bird-download-cli
分片下载命令行工具.主要使用的是 https://github.com/flicat/fast-bird-download 的代码

# 安装
npm i -g fbd-cli


Usage
-----

Usage: fbd-cli [options] [command]

Options:
  -o --output <dir>    输出文件夹
  -c --count <number>  几个链接下载,默认10
  -v, --version        输出版本号
  -h, --help           display help for command

Commands:
  [url]                下载地址


eq
-----
    fbd-cli -c 6 http://download.ydstatic.com/notewebsite/downloads/YoudaoNote.dmg