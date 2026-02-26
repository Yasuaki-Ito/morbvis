## MOrbVis v1.0.0

### 新機能 (New Features)

- **WebGPU コンピュートシェーダーによるMO/密度計算の高速化**: WebGPU対応ブラウザでGPU並列計算が可能に。s/p/d/f 殻（Cartesian・球面調和関数）に対応。非対応環境では自動的にCPU (Web Worker) にフォールバック
- **GPU トグルボタン**: MOセレクター横に ⚡ GPU ON/OFF ボタンを追加
- **グリッド解像度 200**: GPU有効時のみ選択可能（CPU時は160まで）
- **計算中のGPU/CPU表示**: 「⚡ GPU 計算中...」「🖥️ CPU 計算中... XX%」でデバイスを明示
- **HQモード**: トグル式の高品質レンダリング。環境マップ (studio) による自然な反射、SSAO による立体的な陰影、Bloom によるハイライトグローを追加。SSAO強度はスライダーで調整可能
- **動画保存UIの改善**: 録画完了後に「動画を保存」ボタンを表示し、ユーザーが保存タイミングを制御
- **Google Analytics**: GitHub Pages (yasuaki-ito.github.io) でのみ有効化

### バグ修正 (Bug Fixes)

- 新しい分子ファイル読み込み時に原子間距離の測定状態がクリアされるように修正
- 録画完了時のファイル保存ダイアログがタイミングにより表示されない場合がある問題を修正
- 軌道のカスタムカラー設定でカラーピッカーが表示されない場合がある問題を修正
- 比較MO計算中にUIが操作できてしまう問題を修正（`compareComputing` 状態を追加）
- 密度モードで比較MOワイヤーフレームが不正に表示される問題を修正
- 密度モード切替時に比較MOを自動クリア
- 密度モード中のMO切替キーボードショートカットを無効化
- バッチエクスポート中の比較MO退避/復元
- ファイル読み込み時の全計算状態リセット（世代カウンターによる古い結果の破棄）
- 計算中オーバーレイが表示される前にメインスレッドがブロックされる問題を修正

### 改善 (Improvements)

- Reset/Top ビューで分子の幾何学的中心にカメラターゲットを復帰するように変更
- 断面図の正・負の等値面カラーを設定したカラースキームに連動
- 密度断面図で sqrt スケールを採用し低密度領域の可視性を向上
- 計算中に古い等値面メッシュを保持しちらつきを軽減
- MO/密度モード切替時の isovalue 保持・復元
- 比較MO計算の進捗表示
- 録画中の断面インジケーター非表示
- 画像/動画エクスポートの排他制御
- HQモード ON 時のPNG保存でポストプロセス効果を正しくキャプチャ（高DPI時のフレーム待ち最適化）
- ファイル保存を通常ダウンロード方式に統一（PNG/動画/Cube/STL/バッチZIP）

---

### New Features

- **WebGPU Compute Shader for MO/Density Evaluation**: GPU-accelerated parallel computation on WebGPU-capable browsers. Supports s/p/d/f shells (both Cartesian and spherical harmonics). Automatically falls back to CPU (Web Worker) when unavailable
- **GPU Toggle Button**: ⚡ GPU ON/OFF button next to the MO selector
- **Grid Resolution 200**: Available only when GPU is enabled (limited to 160 on CPU)
- **GPU/CPU Computing Indicator**: Displays "⚡ GPU Computing..." or "🖥️ CPU Computing... XX%" during computation
- **HQ Mode**: Toggle-based high-quality rendering. Adds environment map (studio) for natural reflections, SSAO for depth shadows, and Bloom for highlight glow. SSAO intensity adjustable via slider
- **Improved Video Save Dialog**: "Save Video" button shown after recording, giving users explicit control over save timing
- **Google Analytics**: Conditionally enabled only on GitHub Pages (yasuaki-ito.github.io)

### Bug Fixes

- Atom measurement now clears when loading a new molecule file
- Fixed video save dialog sometimes not appearing due to timing issues in MediaRecorder callback
- Fixed custom orbital color picker sometimes not showing
- Fixed UI being operable during compare MO computation (added `compareComputing` state)
- Fixed compare MO wireframe incorrectly appearing in density mode
- Compare MO auto-cleared on density mode switch
- Keyboard shortcuts disabled in density mode
- Compare MO saved/restored during batch export
- Full computation state reset on file load (generation counter discards stale results)
- Fixed computing overlay not appearing before main thread blocks

### Improvements

- Reset/Top view now returns camera target to molecule geometric center
- Cross-section uses configured color scheme instead of hardcoded red/blue
- Density cross-section uses sqrt scale for better low-density visibility
- Old isosurface mesh preserved during computation to reduce flickering
- Isovalue preserved/restored between MO and density modes
- Progress display for compare MO computation
- Cross-section indicator hidden during recording
- Mutual exclusion for image/video export operations
- PNG capture in HQ mode correctly includes post-processing effects (optimized frame wait for high-DPI)
- File saving unified to standard download for all exports (PNG/video/Cube/STL/batch ZIP)
