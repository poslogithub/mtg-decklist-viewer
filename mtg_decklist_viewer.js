function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchCardImage(cardName, setCode = null, cardNo = null) {
    try {
        let imageUrl;
        let searchName = cardName;

        // 分割カードの場合、`//`の左側のみを使用
        if (cardName.includes(" // ")) {
            searchName = cardName.split(" // ")[0].trim(); // 左側（第1面）を取得
        }

        // setCode と cardNo が提供された場合、コレクター番号で直接検索
        if (setCode && cardNo) {
            let response = await fetch(
                `https://api.scryfall.com/cards/${setCode.toLowerCase()}/${cardNo}/ja`
            );
            let data = await response.json();

            // 日本語版カードが見つからなかった場合は、英語版カードを検索
            if (data.object != "card") {
                response = await fetch(
                    `https://api.scryfall.com/cards/${setCode.toLowerCase()}/${cardNo}`
                );
                data = await response.json();
            }
            // 通常のカードの場合
            imageUrl = data.image_uris?.png;
            if (!imageUrl && data.card_faces) {
                // 両面カードの場合、表面の画像を取得
                imageUrl = data.card_faces[0].image_uris?.png;
            }
            if (imageUrl) {
                const imageResponse = await fetch(imageUrl);
                const imageBlob = await imageResponse.blob();
                return URL.createObjectURL(imageBlob);
            }
            throw new Error(`「${cardName} (${setCode} #${cardNo})」の画像が見つかりませんでした`);
        }

        // setCode/cardNoがない場合、または失敗した場合、カード名で検索（フォールバック）
        const response = await fetch(
            `https://api.scryfall.com/cards/search?q=lang:japanese+name:"${encodeURIComponent(searchName)}"`
        );
        const data = await response.json();

        if (data.object == "list" && data.data.length > 0) {
            // カード名の一致を確認
            const exactMatch = data.data.find(card => 
                card.printed_name == searchName
            );
            
            if (exactMatch) {
                // 通常のカードの場合
                imageUrl = exactMatch.image_uris?.png;
                if (imageUrl) {
                    const imageResponse = await fetch(imageUrl);
                    const imageBlob = await imageResponse.blob();
                    return URL.createObjectURL(imageBlob);
                }
                return null;
            } else {
                const faceMatch = data.data.find(card => 
                    card.card_faces && card.card_faces[0].printed_name == searchName
                );
                // 両面カードor分割カード
                if (faceMatch) {
                    imageUrl = faceMatch.card_faces[0].image_uris?.png;
                    if (imageUrl) {
                        // 両面カードの表面
                        const imageResponse = await fetch(imageUrl);
                        const imageBlob = await imageResponse.blob();
                        return URL.createObjectURL(imageBlob);
                    } else {
                        imageUrl = faceMatch.image_uris?.png;
                        if (imageUrl) {
                            // 分割カードの第1面
                            const imageResponse = await fetch(imageUrl);
                            const imageBlob = await imageResponse.blob();
                            return URL.createObjectURL(imageBlob);
                        }
                    }
                }
            }
        }
        throw new Error(`「${cardName}」の日本語版が見つかりませんでした`);
    } catch (error) {
        console.error(error);
        return null;
    }
}

// 全体を画像としてダウンロードする関数
async function downloadAll() {
    const deckContainer = document.getElementById('deckContainer');
    try {
        const canvas = await html2canvas(deckContainer, {
            backgroundColor: '#ffffff', // bodyの背景色（白色）に合わせる
            scale: 1,
            useCORS: true // 外部画像（カード画像）の読み込みを許可
        });
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = 'deck-all.png';
        link.click();
    } catch (error) {
        console.error('画像のダウンロードに失敗しました:', error);
        alert('画像のダウンロードに失敗しました。カード画像が正しく読み込まれていない可能性があります。');
    }
}

async function generateDeckImages() {
    const deckInput = document.getElementById("deckInput").value.trim();
    const deckImagesDiv = document.getElementById("deckImages");
    const sideboardImagesDiv = document.getElementById("sideboardImages");
    const errorDiv = document.getElementById("error");
    const deckSection = document.getElementById("deckSection");
    const sideboardSection = document.getElementById("sideboardSection");
    const downloadAllBtn = document.getElementById("downloadAllBtn");
    const progressDiv = document.getElementById("progress");
    const progressText = document.getElementById("progressText");

    // 初期化
    deckImagesDiv.innerHTML = "";
    sideboardImagesDiv.innerHTML = "";
    errorDiv.textContent = "";
    deckSection.style.display = "none";
    sideboardSection.style.display = "none";
    downloadAllBtn.style.display = "none";
    progressDiv.style.display = "none";

    if (!deckInput) {
        errorDiv.textContent = "デッキリストを入力してください";
        return;
    }

    // 行ごとに分割し、空行でセクションを分離
    const lines = deckInput.split("\n").map(line => line.trim());
    let mainDeckLines = [];
    let sideboardLines = [];
    let isSideboard = false;

    // 先頭の空行を無視しつつ、メインデッキとサイドボードを分離
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] == "" && mainDeckLines.length > 0 && !isSideboard) {
            isSideboard = true; // 最初の空行以降をサイドボードとみなす
            continue;
        }
        if (lines[i] !== "") { // 空行でない場合のみ追加
            if (!isSideboard) {
                mainDeckLines.push(lines[i]);
            } else {
                sideboardLines.push(lines[i]);
            }
        }
    }

    // カードリストを処理する関数
    async function processDeck(lines, targetDiv, targetBoard = "") {
        const cardMap = new Map(); // カード名と数量を管理
    
        for (const line of lines) {
            const match = line.match(/^(\d+)\s+(.+)$/);
            if (match) {
                const quantity = parseInt(match[1], 10);
                let cardName = match[2];
                
                // 括弧とその中身を削除
                cardName = cardName.replace(/（[^）]+）/g, '');
                
                let setCode = null;
                let cardNo = null;
                
                // (セット略号) と番号を抽出
                const setMatch = cardName.match(/\s*\(([A-Z0-9]+)\)\s*(\d+)?$/);
                if (setMatch) {
                    setCode = setMatch[1];
                    cardNo = setMatch[2] ? parseInt(setMatch[2], 10) : null;
                    // マッチした部分をcardNameから削除
                    cardName = cardName.replace(/\s*\([A-Z0-9]+\)\s*\d*$/, '');
                }
                
                // 同一カード名でも setCode と cardNo が異なる場合を考慮して複合キーを生成
                const key = `${cardName}|${setCode || ''}|${cardNo || ''}`;
                if (cardMap.has(key)) {
                    const existing = cardMap.get(key);
                    existing.quantity += quantity;
                } else {
                    cardMap.set(key, { quantity, setCode, cardNo });
                }
            } else {
                if (line != "デッキ" && line != "サイドボード") {
                    errorDiv.textContent += `無効な行: "${line}"\n`;
                }
            }
        }

        const totalCards = cardMap.size; // 処理するカードの総数
        let processedCards = 0;

        // 進捗を更新する関数
        const updateProgress = () => {
            const percentage = totalCards > 0 ? Math.round((processedCards / totalCards) * 100) : 0;
            progressText.textContent = `${targetBoard} 処理中: ${processedCards}/${totalCards} (${percentage}%)`;
        };

        // カード画像のURLを取得
        const cardPromises = Array.from(cardMap.entries()).map(async ([key, { quantity, setCode, cardNo }], index) => {
            const cardName = key.split('|')[0]; // 複合キーからcardNameを抽出
            const imageUrl = await fetchCardImage(cardName, setCode, cardNo);
            await sleep(index * 100); // 1API毎に100ms遅延（Scryfall API利用規約）
            processedCards++;
            updateProgress(); // 進捗を更新
            return { cardName, quantity, imageUrl };
        });
    
        const cardResults = await Promise.all(cardPromises);
    
        // 画像を表示
        cardResults.forEach(({ cardName, quantity, imageUrl }) => {
            const cardContainer = document.createElement("div");
            cardContainer.className = "card-container";
    
            if (imageUrl) {
                const img = document.createElement("img");
                img.src = imageUrl;  // Blob URL（例: blob://...）
                img.alt = cardName;
                img.className = "card-image";
                cardContainer.appendChild(img);
            } else {
                // カード画像のURLが取得できなかった場合は灰色の四角とカード名を表示する
                const placeholder = document.createElement("div");
                placeholder.style.width = "223px";
                placeholder.style.height = "310px";
                placeholder.style.backgroundColor = "#333333";
                placeholder.style.display = "flex";
                placeholder.style.alignItems = "center";
                placeholder.style.justifyContent = "center";
                placeholder.style.color = "white";
                placeholder.style.fontSize = "20px";
                placeholder.style.textAlign = "center";
                placeholder.textContent = cardName;
                cardContainer.appendChild(placeholder);
            }
    
            const quantityDiv = document.createElement("div");
            quantityDiv.className = "card-quantity";
            quantityDiv.textContent = quantity;
    
            cardContainer.appendChild(quantityDiv);
            targetDiv.appendChild(cardContainer);
    
            if (!imageUrl) {
                errorDiv.textContent += `「${cardName}」の画像を取得できませんでした。\n`;
            }
        });
    
        // 合計枚数を計算するために、cardName単位でquantityを合算
        const nameQuantityMap = new Map();
        cardMap.forEach(({ quantity }, key) => {
            const cardName = key.split('|')[0];
            nameQuantityMap.set(cardName, (nameQuantityMap.get(cardName) || 0) + quantity);
        });
    
        return nameQuantityMap; // cardName をキーとする数量マップを返す
    }

    // カード画像取得開始時に「カード画像取得中...」を表示
    progressDiv.style.display = "inline-block";
    progressText.textContent = "処理中: 0/0 (0%)";

    // メインデッキとサイドボードを処理
    const mainDeckMap = await processDeck(mainDeckLines, deckImagesDiv, "メインデッキ");
    let mainDeckCount = 0;
    mainDeckMap.forEach(quantity => mainDeckCount += quantity);

    let sideboardCount = 0;
    if (sideboardLines.length > 0) {
        const sideboardMap = await processDeck(sideboardLines, sideboardImagesDiv, "サイドボード");
        sideboardMap.forEach(quantity => sideboardCount += quantity);
    }

    // カード画像取得完了後に「カード画像取得中...」を非表示
    progressDiv.style.display = "none";

    // タイトルに枚数を追加して表示
    deckSection.querySelector("h2").textContent = `メインデッキ (${mainDeckCount})`;
    deckSection.style.display = "block";

    if (sideboardCount > 0) {
        sideboardSection.querySelector("h2").textContent = `サイドボード (${sideboardCount})`;
        sideboardSection.style.display = "block";
    }

    // メインデッキが生成されたらダウンロードボタンを表示
    if (mainDeckCount > 0) {
        downloadAllBtn.style.display = "inline-block";
    }
}

// イベントリスナーを追加
document.getElementById('generateBtn').addEventListener('click', generateDeckImages);
document.getElementById('downloadAllBtn').addEventListener('click', downloadAll);
