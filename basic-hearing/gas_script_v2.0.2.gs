/**
 * 求人飲食店ドットコム ヒアリングツール - GAS統合スクリプト v2.0
 * =============================================================
 * 対応フォーム：
 *   - 求人ヒアリングフォーム v3.0.0  (formType: "unified") ★メイン
 *   - 店舗情報フォーム v2.0.0        (formType: "store")   ※旧版互換
 *   - 求人原稿フォーム v2.4.0        (formType: "job")     ※旧版互換
 *
 * ============================================================
 * 【初回セットアップ手順】
 * ============================================================
 *  1. このコードをGASエディタ（https://script.google.com）に貼り付けて保存
 *  2. 下記【設定エリア】の3項目を編集する
 *  3. 上部メニュー「デプロイ」→「新しいデプロイ」をクリック
 *  4. 「種類の選択」で「ウェブアプリ」を選択
 *  5. 以下の設定にする：
 *       - 説明（任意）: 求人ヒアリングツール
 *       - 実行するユーザー: 自分
 *       - アクセスできるユーザー: 全員
 *  6. 「デプロイ」ボタンを押し、Googleアカウントの認証を許可する
 *  7. 表示された「ウェブアプリURL」を HTMLファイルの GAS_URL に貼り付ける
 *
 * ============================================================
 * 【コードを修正後に再デプロイする場合】
 * ============================================================
 *  1. コードを保存（Ctrl+S）
 *  2. 「デプロイ」→「デプロイを管理」をクリック
 *  3. 鉛筆アイコン（編集）→「バージョン」を「新しいバージョン」に変更
 *  4. 「デプロイ」ボタンを押す
 *  ※ URLは変わらないので、HTMLの GAS_URL 変更は不要です
 *
 * ============================================================
 * 【Googleドライブの保存構造】
 * ============================================================
 *  📁 求人ヒアリング（PARENT_FOLDER_ID で指定した親フォルダ）
 *    └── 📁 株式会社〇〇_ビストロ〇〇渋谷店（クライアント名で自動作成）
 *          ├── 店舗情報_2026-03-11.json  ← 店舗情報（入力があった場合のみ）
 *          └── 求人原稿_2026-03-11.csv   ← 求人条件CSV
 */

// =============================================================
// 【設定エリア】 ここだけ編集すればOKです
// =============================================================

/**
 * ▼ 通知メールの送信先
 * フォームが送信されたとき、このアドレスに通知メールが届きます。
 * 例: 'tanaka@example.com'
 */
const NOTIFY_EMAIL = 'support@willinc.co.jp';

/**
 * ▼ 保存先のGoogleドライブ フォルダID
 *
 * 空文字('') にすると → マイドライブの直下に保存されます
 *
 * 特定のフォルダに保存したい場合 →
 *   Googleドライブで保存先フォルダを開き、URLの末尾部分をコピーして貼り付けてください
 *   例) https://drive.google.com/drive/folders/【ここがフォルダID】
 */
const PARENT_FOLDER_ID = '1SBu8uCbTsbOUY8BAi469QDErpRI8Xg5k';

/**
 * ▼ 通知メールの送信者名として表示される名前
 * 受信者のメーラーで「差出人」として表示されます。
 */
const SENDER_NAME = '求人飲食店ドットコム ヒアリングツール';

// =============================================================
// メインルーター
// =============================================================

function doPost(e) {
   Logger.log('受信データ: ' + JSON.stringify(e.postData)); // ← この1行を追加
    try {
        const payload  = JSON.parse(e.postData.contents);
        const formType = payload.formType || 'unknown';

        if      (formType === 'unified') return handleUnified(payload);
        else if (formType === 'store')   return handleStore(payload);
        else if (formType === 'job')     return handleJob(payload);
        else return jsonResponse({ status: 'error', message: '不明なフォーム種別: ' + formType });

    } catch (err) {
        return jsonResponse({ status: 'error', message: err.toString() });
    }
}

/** 動作確認用（GETリクエスト） */
function doGet() {
    return jsonResponse({ status: 'ok', message: 'GAS WebApp is running. v2.0' });
}

// =============================================================
// unified フォーム処理（v3.0.0統合版）
// =============================================================

function handleUnified(payload) {
    const clientName  = payload.clientName  || '未設定';
    const storeData   = payload.storeData   || {};
    const csvContent  = payload.csvContent  || '';
    const csvFileName = payload.csvFileName || `求人原稿_${clientName}_${formatDate(new Date())}.csv`;

    const folder = getOrCreateFolder(getParentFolder(), clientName);
    const date   = formatDate(new Date());
    const results = {};

    // ---- 店舗情報をJSONで保存（storeDataに中身がある場合のみ）----
    const hasStoreData = Object.keys(storeData).filter(k =>
        !['formType','clientName','submittedAt'].includes(k) && String(storeData[k]).trim() !== ''
    ).length > 0;

    if (hasStoreData) {
        const storeFileName = `店舗情報_${clientName}_${date}.json`;
        deleteIfExists(folder, storeFileName);
        const blob = Utilities.newBlob(JSON.stringify(storeData, null, 2), 'application/json', storeFileName);
        const file = folder.createFile(blob);
        results.storeFileId  = file.getId();
        results.storeFileUrl = file.getUrl();
    }

    // ---- 求人原稿をCSVで保存 ----
    if (csvContent.trim().replace(/^\uFEFF/, '') !== '') {
        deleteIfExists(folder, csvFileName);
        const cleaned = csvContent.replace(/^\uFEFF/, '');
        const blob = Utilities.newBlob(cleaned, 'text/csv; charset=utf-8', csvFileName);
        const file = folder.createFile(blob);
        results.csvFileId  = file.getId();
        results.csvFileUrl = file.getUrl();
    }

    // ---- 通知メール ----
    const subject = `【求人ヒアリング受信】${clientName}`;
    const body    = buildUnifiedEmailBody(clientName, storeData, csvFileName, hasStoreData, folder.getUrl(), results);
    sendNotification(subject, body);

    return jsonResponse({
        status: 'ok',
        folderUrl: folder.getUrl(),
        ...results
    });
}

function buildUnifiedEmailBody(clientName, storeData, csvFileName, hasStore, folderUrl, results) {
    const lines = [
        '求人ヒアリングフォームから新規データを受信しました。',
        '',
        `■ クライアント名：${clientName}`,
        `■ 受信日時：${formatDateTime(new Date())}`,
        '',
    ];

    if (hasStore) {
        lines.push('■ 店舗情報（入力あり）');
        if (storeData.s_companyName) lines.push(`  法人名：${storeData.s_companyName}`);
        if (storeData.s_storeName)   lines.push(`  店舗名：${storeData.s_storeName}`);
        if (storeData.s_staffName)   lines.push(`  担当者：${storeData.s_staffName}${storeData.s_staffTitle ? '（' + storeData.s_staffTitle + '）' : ''}`);
        if (storeData.s_tel_contact) lines.push(`  連絡先：${storeData.s_tel_contact}`);
        if (storeData.s_email_1)     lines.push(`  メール：${storeData.s_email_1}`);
        if (results.storeFileUrl)    lines.push(`  JSONファイル：${results.storeFileUrl}`);
        lines.push('');
    } else {
        lines.push('■ 店舗情報：入力なし（既存顧客のため省略）');
        lines.push('');
    }

    lines.push(`■ 求人原稿ファイル：${csvFileName}`);
    if (results.csvFileUrl) lines.push(`  CSVファイル：${results.csvFileUrl}`);
    lines.push('');
    lines.push(`■ Googleドライブフォルダ：${folderUrl}`);

    return lines.join('\n');
}

// =============================================================
// store フォーム処理（v2.0.0 旧版互換）
// =============================================================

function handleStore(data) {
    const clientName  = data.clientName || '未設定';
    const folder      = getOrCreateFolder(getParentFolder(), clientName);
    const date        = formatDate(new Date());
    const fileName    = `店舗情報_${clientName}_${date}.json`;

    deleteIfExists(folder, fileName);
    const blob = Utilities.newBlob(JSON.stringify(data, null, 2), 'application/json', fileName);
    const file = folder.createFile(blob);

    const subject = `【店舗情報受信】${data.storeName || clientName}`;
    const body = [
        '店舗情報ヒアリングフォームから新規データを受信しました。',
        '',
        `■ 法人名：${data.companyName || ''}`,
        `■ 店舗名：${data.storeName || ''}`,
        `■ 担当者：${data.staffName || ''}`,
        `■ 受信日時：${data.submittedAt || formatDateTime(new Date())}`,
        '',
        `■ JSONファイル：${file.getUrl()}`,
        `■ フォルダ：${folder.getUrl()}`,
    ].join('\n');
    sendNotification(subject, body);

    return jsonResponse({ status: 'ok', fileId: file.getId(), fileUrl: file.getUrl(), folderUrl: folder.getUrl() });
}

// =============================================================
// job フォーム処理（v2.4.0 旧版互換）
// =============================================================

function handleJob(data) {
    const clientName  = data.clientName || '未設定';
    const fileName    = data.fileName   || `求人原稿_${clientName}_${formatDate(new Date())}.csv`;
    const csvContent  = data.csvContent || '';

    if (!csvContent.trim()) {
        return jsonResponse({ status: 'error', message: 'CSVデータが空です。' });
    }

    const folder  = getOrCreateFolder(getParentFolder(), clientName);
    const cleaned = csvContent.replace(/^\uFEFF/, '');
    deleteIfExists(folder, fileName);
    const blob = Utilities.newBlob(cleaned, 'text/csv; charset=utf-8', fileName);
    const file = folder.createFile(blob);

    const subject = `【求人原稿受信】${clientName}`;
    const body = [
        '求人原稿作成フォームから新規データを受信しました。',
        '',
        `■ クライアント名：${clientName}`,
        `■ ファイル名：${fileName}`,
        `■ 受信日時：${formatDateTime(new Date())}`,
        '',
        `■ CSVファイル：${file.getUrl()}`,
        `■ フォルダ：${folder.getUrl()}`,
    ].join('\n');
    sendNotification(subject, body);

    return jsonResponse({ status: 'ok', fileId: file.getId(), fileUrl: file.getUrl(), folderUrl: folder.getUrl() });
}

// =============================================================
// 共通ユーティリティ
// =============================================================

function testFolderAccess() {
    const folder = DriveApp.getFolderById('1SBu8uCbTsbOUY8BAi469QDErpRI8Xg5k');
    folder.createFile('テスト_削除してください.txt', 'テスト', MimeType.PLAIN_TEXT);
    Logger.log('成功：' + folder.getName());
}

function getParentFolder() {
    return PARENT_FOLDER_ID
        ? DriveApp.getFolderById(PARENT_FOLDER_ID)
        : DriveApp.getRootFolder();
}

function getOrCreateFolder(parent, name) {
    const iter = parent.getFoldersByName(name);
    return iter.hasNext() ? iter.next() : parent.createFolder(name);
}

function deleteIfExists(folder, fileName) {
    const iter = folder.getFilesByName(fileName);
    while (iter.hasNext()) iter.next().setTrashed(true);
}

function sendNotification(subject, body) {
    if (!NOTIFY_EMAIL || NOTIFY_EMAIL === 'your-email@example.com') return;
    MailApp.sendEmail({ to: NOTIFY_EMAIL, subject, body, name: SENDER_NAME });
}

function jsonResponse(data) {
    return ContentService
        .createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDateTime(date) {
    return date.toLocaleString('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}
