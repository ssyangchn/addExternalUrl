// author: @bpking  https://github.com/bpking1/embyExternalUrl
// 选填项
// 外网 emby 地址,如果上层无反代或传递了 Host 标头或 docker 为 host 网络,此处可为空
let serverAddr = 'https://bpking.top';

// 正常情况请勿填写和更改,程序内部用的全局变量
let api_key = '';
let domain = '';
let oriData = '';
let osType = '';
const redirectKey = 'redirect2external';
const jfPath = '/jf'

const addExternalUrl = async (r, data, flags) => {
    if (flags.last === false) {
        oriData += data;
        return;
    } else {
        data = JSON.parse(oriData);
    }
    try {
        fillApiKeyAndServerType(r);
        osType = getOS(r);

        // 外链地址协议默认从调用者取,如果上级还有反代服务器且上级配置了 https 而此服务是 http,需要自行将 ${r.variables.scheme} 改为 https
        // 如果是反代服务器两种都有,可以将这一行注释掉,统一使用第一行填写的地址
        serverAddr = r.headersIn.Host ? `${r.variables.scheme}://${r.headersIn.Host}${jfPath}` : serverAddr;
        r.warn(`api_key: ${api_key}`);
        r.warn(`osType: ${osType}`);
        r.warn(`serverAddr: ${serverAddr}`)
        if (data.MediaSources && data.MediaSources.length > 0) {
            data = addUrl(r, data);
        }
        r.sendBuffer(JSON.stringify(data), flags);
    } catch (error) {
        r.error(`addExternalUrl error: ${error}`);
    }
    r.done();
}

const addUrl = (r, data) => {
    data.MediaSources.map(mediaSource => {
        const fileName = encodeURIComponent(mediaSource.Path.replace(/.*[\\/]/, ""));
        // origin link: /emby/videos/401929/stream.xxx?xxx
        // modify link: /emby/videos/401929/stream/xxx.xxx?xxx
        // this is not important, hit "/emby/videos/401929/" path level still worked

        const streamUrl = `${serverAddr}/Items/${mediaSource.Id}/Download/${data.Name}.${mediaSource.Container}?api_key=${api_key}`;
        //get subtitle
        let subUrl = '';
        try {
            subUrl = getSubUrl(r, mediaSource,data.Id);
        } catch (error) {
            r.error(`get sub url error: ${error}`);
        }
        //get displayTitle
        let displayTitle = '';
        try {
            let vd = mediaSource.MediaStreams.find(s => s.Type === 'Video');
            displayTitle = vd.DisplayTitle;
            displayTitle = typeof displayTitle === 'undefined' ? '' : displayTitle;
            let size = " " + formatBytes(mediaSource.Size);
            displayTitle = displayTitle + size;
            vd.DisplayTitle = displayTitle
        } catch (error) {
            r.error(`get displayTitle error: ${error}`);
        }
        //get position
        const position = parseInt(data.UserData.PlaybackPositionTicks / 10000);

        const mediaInfo = {
            title: data.Name,
            streamUrl,
            subUrl,
            position,
            displayTitle,
            mediaSourceName: mediaSource.Name
        }
        data.ExternalUrls.push(getPotUrl(mediaInfo));
        data.ExternalUrls.push(getInfuseUrl(mediaInfo));
        data.ExternalUrls.push(getNPlayerUrl(mediaInfo));
        //data.ExternalUrls.push(getVlcUrl(mediaInfo));
        //MAC平台
        //data.ExternalUrls.push(getIinaUrl(mediaInfo));
        //安卓平台
        //data.ExternalUrls.push(getMXUrl(mediaInfo));
    });
    return data;
}

// URL with "intent" scheme 只支持
// String => 'S'
// Boolean =>'B'
// Byte => 'b'
// Character => 'c'
// Double => 'd'
// Float => 'f'
// Integer => 'i'
// Long => 'l'
// Short => 's'

const getPotUrl = (mediaInfo) => {
    //let potUrl =
    return {
        Name: `PotPlayer-${mediaInfo.mediaSourceName}(${mediaInfo.displayTitle})`,
        Url: `potplayer://${encodeURI(mediaInfo.streamUrl)} /sub=${encodeURI(mediaInfo.subUrl)} /seek=${getSeek(mediaInfo.position)}`
    }
}

// https://wiki.videolan.org/Android_Player_Intents/
const getVlcUrl = (mediaInfo) => {
    // android subtitles:  https://code.videolan.org/videolan/vlc-android/-/issues/1903
    let vlcUrl = `intent:${encodeURI(mediaInfo.streamUrl)}#Intent;package=org.videolan.vlc;type=video/*;S.subtitles_location=${encodeURI(mediaInfo.subUrl)};S.title=${encodeURI(mediaInfo.title)};i.position=${mediaInfo.position};end`;
    if (osType === 'windows') {
        // PC端需要额外设置,参考这个项目,MPV也是类似的方法:  https://github.com/stefansundin/vlc-protocol
        vlcUrl = `vlc://${encodeURI(mediaInfo.streamUrl)}`;
    }
    if (osType === 'ios') {
        // https://wiki.videolan.org/Documentation:IOS/#x-callback-url
        // ios: https://code.videolan.org/videolan/vlc-ios/-/commit/55e27ed69e2fce7d87c47c9342f8889fda356aa9
        vlcUrl = `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(mediaInfo.streamUrl)}&sub=${encodeURIComponent(mediaInfo.subUrl)}`;
    }
    const vlcUrl64 = Buffer.from(vlcUrl, 'utf8').toString('base64');
    return {
        Name: `VLC-${mediaInfo.mediaSourceName}(${mediaInfo.displayTitle})`,
        Url: `${serverAddr}/${redirectKey}?link=${vlcUrl64}`
    }
}

// https://github.com/iina/iina/issues/1991
const getIinaUrl = (mediaInfo) => {
    return {
        Name: `IINA-${mediaInfo.mediaSourceName}(${mediaInfo.displayTitle})`,
        Url: `iina://weblink?url=${encodeURIComponent(mediaInfo.streamUrl)}&new_window=1`
    }
}

const getInfuseUrl = (mediaInfo) => {
    // sub 参数限制: 播放带有外挂字幕的单个视频文件（Infuse 7.6.2 及以上版本）
    // see: https://support.firecore.com/hc/zh-cn/articles/215090997
    const infuseUrl = `infuse://x-callback-url/play?url=${encodeURIComponent(mediaInfo.streamUrl)}&sub=${encodeURIComponent(mediaInfo.subUrl)}`;
    const infuseUrl64 = Buffer.from(infuseUrl, 'utf8').toString('base64');
    return {
        Name: `Infuse-${mediaInfo.mediaSourceName}(${mediaInfo.displayTitle})`,
        Url: `${serverAddr}/${redirectKey}?link=${infuseUrl64}`
    }
}

// https://sites.google.com/site/mxvpen/api
// https://mx.j2inter.com/api
// https://support.mxplayer.in/support/solutions/folders/43000574903
const getMXUrl = (mediaInfo) => {
    // mxPlayer free
    const mxUrl = `intent:${encodeURI(mediaInfo.streamUrl)}#Intent;package=com.mxtech.videoplayer.ad;S.title=${encodeURI(mediaInfo.title)};i.position=${mediaInfo.position};end`;
    const mxUrl64 = Buffer.from(mxUrl, 'utf8').toString('base64');
    // mxPlayer Pro
    // const mxUrl = `intent:${encodeURI(mediaInfo.streamUrl)}#Intent;package=com.mxtech.videoplayer.pro;S.title=${encodeURI(mediaInfo.title)};i.position=${mediaInfo.position};end`;
    return {
        Name: `MX Player-${mediaInfo.mediaSourceName}(${mediaInfo.displayTitle})`,
        Url: `${serverAddr}/${redirectKey}?link=${mxUrl64}`
    }
}

const getNPlayerUrl = (mediaInfo) => {
    let nplayerUrl = osType === "macOS"
        ? `nplayer-mac://weblink?url=${encodeURIComponent(mediaInfo.streamUrl)}&new_window=1`
        : `nplayer-${encodeURI(mediaInfo.streamUrl)}`;
    const nplayerUrl64 = Buffer.from(nplayerUrl, 'utf8').toString('base64');
    return {
        Name: `nPlayer-${mediaInfo.mediaSourceName}(${mediaInfo.displayTitle})`,
        Url: `${serverAddr}/${redirectKey}?link=${nplayerUrl64}`
    }
}


const getSeek = (position) => {
    let ticks = position * 10000;
    let parts = []
        , hours = ticks / 36e9;
    (hours = Math.floor(hours)) && parts.push(hours);
    let minutes = (ticks -= 36e9 * hours) / 6e8;
    ticks -= 6e8 * (minutes = Math.floor(minutes)),
    minutes < 10 && hours && (minutes = "0" + minutes),
        parts.push(minutes);
    let seconds = ticks / 1e7;
    return (seconds = Math.floor(seconds)) < 10 && (seconds = "0" + seconds),
        parts.push(seconds),
        parts.join(":")
}

const getSubUrl = (r, mediaSource,Id) => {
    let subTitleUrl = '';
    //尝试返回第一个外挂中字
    const chiSubIndex = mediaSource.MediaStreams.findIndex(m => m.Language === "chi" && m.IsExternal);
    r.warn('chisubINdex: ' + chiSubIndex);
    if (chiSubIndex > -1) {
        const subtitleCodec = mediaSource.MediaStreams[chiSubIndex].Codec;
        subTitleUrl = `${serverAddr}/Videos/${Id}/${mediaSource.Id}/Subtitles/${chiSubIndex}/0/Stream.${subtitleCodec}?api_key=${api_key}`;
    } else {
        //尝试返回第一个外挂字幕
        const externalSubIndex = mediaSource.MediaStreams.findIndex(m => m.IsExternal);
        r.warn('subIndex: ' + externalSubIndex);
        if (externalSubIndex > -1) {
            const subtitleCodec = mediaSource.MediaStreams[externalSubIndex].Codec;
            subTitleUrl = `${serverAddr}/Videos/${Id}/${mediaSource.Id}/Subtitles/${externalSubIndex}/0/Stream.${subtitleCodec}?api_key=${api_key}`;
        }
    }
    return subTitleUrl;
}

/**
 * getOS, copy from embyLaunchPotplayer.js
 * @param {Object} r nginx objects, HTTP Request
 * @returns windows...
 */
const getOS = (r) => {
    const ua = r.headersIn["User-Agent"]
    r.warn(`getOS UA: ${ua}`)
    if (!!ua.match(/compatible/i) || ua.match(/Windows/i)) {
        return 'windows'
    } else if (!!ua.match(/iphone/i) || ua.match(/Ipad/i) || r.headersIn["X-Emby-Authorization"].match(/iPad/i)) {
        return 'ios'
    } else if (!!ua.match(/Macintosh/i) || ua.match(/MacIntel/i)) {
        return 'macOS'
    } else if (ua.match(/android/i)) {
        return 'android'
    } else if (ua.match(/Ubuntu/i)) {
        return 'ubuntu'
    } else {
        return 'other'
    }
}

const fillApiKeyAndServerType = (r) => {
    const jellyfinAuth = r.headersIn['X-Emby-Authorization']
    if (jellyfinAuth) {
        const regex = /Token="([^"]+)"/;
        const match = jellyfinAuth.match(regex);
        if (match && match.length > 1) {
            api_key = match[1];
        }
    }
}

function HeaderFilter(r) {
    r.headersOut['Content-Length'] = null;
}

const redirectUrl = (r) => {
    const baseLink = r.args.link;
    r.warn(`baseLink:  ${baseLink}`);
    const link = Buffer.from(baseLink, 'base64').toString('utf8');
    r.return(302, link);
}

const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + sizes[i];
}

export default { addExternalUrl, redirectUrl, HeaderFilter };
