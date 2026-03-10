(function () {
  const style = document.createElement('style');
  style.textContent = `
        :root { --p-pink: #ff007f; --p-bg: #fff5f8; }
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, system-ui, sans-serif;
            background: var(--p-bg);
            text-align: center;
            color: #333;
            margin: 0;
            padding: 5px 5px 80px 5px;
            overflow-x: hidden;
            -webkit-tap-highlight-color: transparent;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 4px;
            width: 100%;
            max-width: 500px;
            margin: 10px auto;
            padding: 0 5px;
        }
        .cell {
            width: 100%;
            aspect-ratio: 1/1;
            border: 1px solid #ddd;
            border-radius: 6px;
            background: white;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 10px;
            position: relative;
            overflow: hidden;
        }
        .cell span { font-size: 7px; line-height: 1; margin-top: 2px; }
        .cell.gold { border: 2px solid #ffaa00 !important; background: #fffdf0; }
        .cell.gold::after { content: "👑"; position: absolute; top: 0; right: 0; font-size: 7px; }
        .cell.magic { border: 2px solid #7e57c2 !important; background: #f5efff; }
        .cell.magic::after { content: "🔮"; position: absolute; top: 0; right: 0; font-size: 7px; }
        .cell.minigame { border: 2px solid #00acc1 !important; background: #e0f7fa; }
        .cell.minigame::after { content: "🎮"; position: absolute; top: 0; right: 0; font-size: 7px; }
        .cell.magnet { border: 2px solid #ec407a !important; background: #ffeaf3; }
        .cell.magnet::after { content: "👯"; position: absolute; top: 0; right: 0; font-size: 7px; }
        .cell.item::after { content: "🎁"; position: absolute; top: 0; right: 0; font-size: 7px; }
        .cell.excluded { opacity: 0.5; filter: grayscale(1); }

        .timer-box { background: white; border-radius: 12px; padding: 10px; margin: 5px auto; width: 95%; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
        #round-timer { font-size: 22px; font-weight: 900; color: #222; }
        .news-box { background: white; border-radius: 12px; padding: 8px; margin: 8px auto; width: 95%; box-shadow: 0 2px 8px rgba(0,0,0,0.05); text-align: left; }
        .inventory-box { background: white; border-radius: 12px; padding: 8px; margin: 8px auto; width: 95%; box-shadow: 0 2px 8px rgba(0,0,0,0.05); text-align: left; }
        .inventory-title { font-size: 11px; color: var(--p-pink); font-weight: bold; margin-bottom: 6px; }
        .inventory-row { display: flex; gap: 6px; flex-wrap: wrap; }
        .inv-chip { background:#f8f8f8; border:1px solid #eee; border-radius:999px; padding:4px 8px; font-size:12px; }
        .news-header { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom: 6px; }
        .news-title { font-size: 11px; color: var(--p-pink); font-weight: bold; margin: 0; }
        .news-toggle-btn { border:1px solid #f8bbd0; border-radius:999px; background:#fff; color:#c2185b; font-size:11px; padding:3px 10px; }
        .news-list { max-height: 0; overflow: hidden; transition: max-height 0.22s ease; }
        .news-list.expanded { max-height: 150px; overflow-y: auto; }
        .news-item { font-size:12px; color:#444; padding:4px 0; border-bottom:1px dashed #f1f1f1; }
        .news-item:last-child { border-bottom:none; }
        .news-preview { font-size:12px; color:#666; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

        .nav-bar { position: fixed; bottom: 0; left: 0; width: 100%; background: white; display: flex; height: 65px; border-top: 1px solid #eee; z-index: 1000; }
        .nav-item { background: none; border: none; font-size: 10px; color: #888; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .nav-item.active { color: var(--p-pink); font-weight: bold; }
        #dice-btn, .admin-btn { padding: 12px; font-size: 15px; border-radius: 12px; border: none; background: var(--p-pink); color: white; font-weight: bold; width: 95%; margin: 8px 0; }
        #dice-btn:disabled { background: #ccc; }

        .admin-section { background: white; padding: 12px; border-radius: 12px; margin: 8px; border: 1px solid #eee; text-align: left; }
        .admin-input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 8px; font-size: 14px; }
        .works-card { background: white; border: 1px solid #eee; border-radius: 12px; padding: 10px; margin: 8px; text-align: left; }
        .work-image { width: 100%; border-radius: 10px; margin-top: 8px; border: 1px solid #eee; }
        .work-stage-block { margin-top:8px; border:1px solid #f0f0f0; border-radius:10px; padding:8px; background:#fff; }
        .collapse-head { display:flex; align-items:center; justify-content:space-between; gap:8px; cursor:pointer; font-size:12px; font-weight:bold; color:#444; }
        .collapse-toggle { border:1px solid #f8bbd0; border-radius:999px; padding:2px 8px; background:#fff; color:#c2185b; font-size:11px; }
        .collapse-body { display:none; margin-top:6px; }
        .collapse-body.expanded { display:block; }
        .player-notification { position:fixed; top:14px; left:50%; transform:translateX(-50%); width:min(92vw,560px); background:#fff; border:2px solid #f48fb1; border-radius:14px; box-shadow:0 12px 30px rgba(0,0,0,0.24); padding:12px 34px 12px 12px; z-index:2600; text-align:left; }
        .player-notification-close { position:absolute; right:10px; top:8px; border:none; background:transparent; font-size:18px; color:#ad1457; font-weight:bold; }
        .admin-mini-box { position:fixed; right:8px; bottom:78px; width:min(92vw,340px); background:#fff; border:1px solid #f8bbd0; border-radius:12px; box-shadow:0 6px 16px rgba(0,0,0,0.15); z-index:1200; text-align:left; }
        .admin-mini-box.hidden .admin-mini-body { display:none; }
        .admin-mini-head { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 10px; font-size:12px; font-weight:bold; color:#ad1457; }
        .admin-mini-body { padding:0 10px 10px; font-size:12px; color:#555; max-height:220px; overflow:auto; }
        .status-chip { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: bold; }
        .status-pending { background: #fff3cd; color: #856404; }
        .status-accepted { background: #d4edda; color: #155724; }
        .status-rejected { background: #f8d7da; color: #721c24; }

        #modal, #overlay { display: none; }
        #modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 15px; border-radius: 20px; z-index: 1100; width: 90%; max-height: 85vh; overflow-y: auto; box-shadow: 0 0 40px rgba(0,0,0,0.2); }
        #overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); z-index: 1050; }

        .tab-content { display: none; width: 100%; }
        .tab-active { display: block; animation: fadeIn 0.1s; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        @keyframes shake {
            0% { transform: translate(1px, 1px) rotate(0deg); }
            10% { transform: translate(-1px, -2px) rotate(-1deg); }
            20% { transform: translate(-3px, 0px) rotate(1deg); }
            30% { transform: translate(3px, 2px) rotate(0deg); }
            40% { transform: translate(1px, -1px) rotate(1deg); }
            50% { transform: translate(-1px, 2px) rotate(-1deg); }
            60% { transform: translate(-3px, 1px) rotate(0deg); }
            70% { transform: translate(3px, 1px) rotate(-1deg); }
            80% { transform: translate(-1px, -1px) rotate(1deg); }
            90% { transform: translate(1px, 2px) rotate(0deg); }
            100% { transform: translate(1px, -2px) rotate(-1deg); }
        }
        .apply-shake { animation: shake 0.5s; }

        table { width: 100%; border-collapse: collapse; font-size: 11px; background: white; border-radius: 10px; }
        th, td { padding: 8px 4px; border-bottom: 1px solid #eee; text-align: center; }
        .row-excluded { background: #f0f0f0; color: #aaa; text-decoration: line-through; }

        .magic-draw-container {
            position: relative;
            width: min(96vw, 620px);
            min-height: 420px;
            margin: 0 auto 10px;
            border-radius: 20px;
            overflow: hidden;
            border: 1px solid rgba(255, 215, 120, 0.35);
            background: radial-gradient(circle at 50% 48%, rgba(95, 138, 255, 0.24), transparent 36%), linear-gradient(180deg, #040919 0%, #070f2f 55%, #030714 100%);
            box-shadow: inset 0 0 55px rgba(114, 169, 255, 0.18), inset 0 -18px 40px rgba(0, 0, 0, 0.46), 0 16px 38px rgba(0,0,0,0.45);
        }
        .magic-cards-stage {
            position: relative;
            width: 100%;
            min-height: 420px;
            perspective: 1400px;
            isolation: isolate;
        }
        .magic-ticket-star {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(calc(-50% + var(--sx, 0px)), calc(-50% + var(--sy, 0px)));
            color: rgba(255, 245, 205, 0.9);
            text-shadow: 0 0 9px rgba(255, 241, 189, 0.35);
            opacity: var(--so, 0.5);
            font-size: var(--sf, 12px);
            animation: twinkle var(--tw, 3s) ease-in-out infinite;
            pointer-events: none;
            z-index: 1;
            transition: transform 1000ms cubic-bezier(.2,.8,.2,1), opacity 900ms ease;
            will-change: transform, opacity;
        }
        .magic-ticket-star.is-converging {
            transform: translate(calc(-50% + var(--cx, 0px)), calc(-50% + var(--cy, 0px))) scale(0.8);
            opacity: 0;
        }
        .magic-card {
            position: absolute;
            left: 50%;
            top: 50%;
            width: clamp(82px, 17vw, 122px);
            aspect-ratio: 1 / 1.55;
            transform-style: preserve-3d;
            transform: translate(-50%, -50%) scale(0.2);
            opacity: 0;
            transition: transform 700ms cubic-bezier(.2,.8,.2,1), opacity 600ms ease;
            filter: drop-shadow(0 0 15px rgba(255, 215, 0, 0.24));
            z-index: 3;
            will-change: transform;
        }
        .magic-card.is-visible { opacity: 1; }
        .magic-card.is-vanishing { opacity: 0; transition: transform 820ms ease, opacity 820ms ease; }
        .magic-card.is-focused { z-index: 50 !important; }
        .magic-card-inner {
            width: 100%;
            height: 100%;
            position: relative;
            transform-style: preserve-3d;
            transition: transform 1400ms cubic-bezier(.2,.8,.2,1);
        }
        .magic-card.is-revealed .magic-card-inner { transform: rotateY(180deg); }
        .magic-card-face {
            position: absolute;
            inset: 0;
            border-radius: 12px;
            border: 2px solid #FFD700;
            backface-visibility: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 10px;
            font-weight: 700;
            box-shadow: 0 0 20px rgba(255, 215, 0, 0.4);
        }
        .magic-card-back {
            background: radial-gradient(circle at 35% 28%, #213a88 0%, #0d1a49 45%, #090d26 100%);
            color: #f8df8a;
            font-size: 24px;
            letter-spacing: 2px;
        }
        .magic-card-front {
            transform: rotateY(180deg);
            background: linear-gradient(150deg, #fffdf4, #f1e3b9);
            color: #2b1800;
            font-family: 'Cinzel', Georgia, serif;
        }
        .magic-card-front small { display:block; font-size:11px; color:#7d6332; margin-bottom:7px; }
        .magic-card-front b { display:block; font-size:20px; margin-bottom:7px; }
        .magic-card-front span { font-size:13px; line-height:1.25; }
        .magic-sparkle-layer { position:absolute; inset:0; pointer-events:none; overflow:hidden; z-index: 4; }
        .magic-spark {
            position:absolute;
            width:8px;
            height:8px;
            border-radius:50%;
            background: radial-gradient(circle, #fff6b8, #ffc938 70%, rgba(255,201,56,0));
            animation: sparkle-burst 1200ms ease-out forwards;
        }
        .magic-winner-banner { z-index: 7;
            position:absolute;
            left:50%;
            bottom:14px;
            transform:translateX(-50%) scale(.9);
            background:rgba(255, 223, 136, 0.2);
            border:1px solid rgba(255,215,120,.65);
            color:#fff7d0;
            padding:8px 16px;
            border-radius:999px;
            font-weight:900;
            opacity:0;
            transition:all 420ms ease;
            text-shadow:0 2px 10px rgba(0,0,0,.35);
        }
        .magic-winner-banner.show { opacity:1; transform:translateX(-50%) scale(1); }
        @keyframes twinkle {
            0%, 100% { opacity: calc(var(--so, 0.5) * 0.65); }
            50% { opacity: var(--so, 0.5); }
        }
        @keyframes sparkle-burst {
            0% { transform: translate(0,0) scale(0.4); opacity: 1; }
            100% { transform: translate(var(--dx), var(--dy)) scale(1.4); opacity: 0; }
        }
        @media (max-width: 520px) {
            .magic-card.is-focused { transform: translate(-50%, -50%) scale(1.25) !important; }
        }
        .winner-toast {
            position: fixed;
            top: 14px;
            left: 50%;
            transform: translateX(-50%);
            width: min(92vw, 520px);
            background: linear-gradient(135deg,#fffde7,#fce4ec);
            border: 2px solid #f48fb1;
            border-radius: 14px;
            box-shadow: 0 12px 30px rgba(0,0,0,0.24);
            padding: 12px 34px 12px 12px;
            z-index: 2500;
            text-align: left;
            display: none;
        }
        .winner-toast-close {
            position:absolute;
            right:10px;
            top:8px;
            border:none;
            background:transparent;
            font-size:18px;
            color:#ad1457;
            font-weight:bold;
        }

        .admin-inner-tabs { display:flex; gap:6px; margin:10px 0; }
        .admin-inner-tab-btn { flex:1; border:1px solid #f8bbd0; border-radius:10px; background:#fff; color:#c2185b; padding:8px; font-weight:bold; }
        .admin-inner-tab-btn.active { background:#ffe4ef; }
        .admin-inner-panel { display:none; }
        .admin-inner-panel.active { display:block; }

        .event-alert {
            display:none;
            margin: 8px auto;
            width:95%;
            background:#fff8e1;
            border:1px solid #ffecb3;
            border-radius:12px;
            padding:10px;
            text-align:left;
            font-size:13px;
        }
        .event-alert button {
            margin-top:8px;
            border:none;
            background:#ff9800;
            color:white;
            border-radius:8px;
            padding:8px 10px;
            font-weight:bold;
        }
        .event-alert.epic {
            background: linear-gradient(135deg, #fff3e0, #fce4ec 55%, #ede7f6);
            border: 2px solid #ff80ab;
            box-shadow: 0 6px 18px rgba(194, 24, 91, 0.15);
        }
        .event-alert.epic .event-title { font-size:15px; font-weight:900; color:#ad1457; margin-bottom:5px; }
        .event-alert.epic .event-sub { color:#6a1b9a; line-height:1.35; }
        .event-alert.epic .event-join-btn {
            width:100%;
            background: linear-gradient(135deg, #ff4081, #ab47bc);
            color:white;
            border:none;
            border-radius:10px;
            padding:10px 12px;
            font-weight:900;
            letter-spacing: .2px;
        }
        
        #event-notification.event-notification-pink {
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            width: min(94vw, 560px);
            background: #ffebf2;
            border: 1px solid #ffc1d6;
            border-radius: 15px;
            box-shadow: 0 10px 24px rgba(236, 107, 164, 0.24);
            padding: 12px;
            z-index: 2300;
            animation: eventNotifIn .28s ease-out;
        }
        .event-notification-text {
            color: #8a2b58;
            font-size: 13px;
            line-height: 1.4;
            font-weight: 700;
            margin-bottom: 10px;
        }
        .event-notification-join {
            width: 100%;
            border: none;
            border-radius: 12px;
            padding: 10px 12px;
            font-weight: 800;
            color: #fff;
            background: linear-gradient(135deg, #ff4fa3 0%, #d81b7c 100%);
            box-shadow: 0 6px 14px rgba(216, 27, 124, 0.35);
        }
        @keyframes eventNotifIn {
            from { opacity: 0; transform: translate(-50%, -8px); }
            to { opacity: 1; transform: translate(-50%, 0); }
        }
#event-celebration-overlay {
            position: fixed;
            inset: 0;
            pointer-events: none;
            z-index: 2400;
            overflow: hidden;
        }
        .firework-dot {
            position: absolute;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            opacity: 0.95;
            animation: fw-fall 1300ms ease-out forwards;
        }
        @keyframes fw-fall {
            0% { transform: translate(0,0) scale(1); opacity: 1; }
            100% { transform: translate(var(--dx), var(--dy)) scale(0.5); opacity: 0; }
        }
        body.event-mode {
            padding: 0;
            overflow: hidden;
        }
        body.event-mode #event-notification {
            display: none !important;
        }
        .event-overlay {
            position: fixed;
            inset: 0;
            background: #111;
            z-index: 2000;
            display: none;
            flex-direction: column;
            color: #fff;
        }
        .event-overlay { display: none; flex-direction: column; }
        .event-overlay-header {
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:8px;
            padding:10px;
            background: rgba(0, 0, 0, 0.72);
        }
        .event-screen-title { font-weight:800; font-size:16px; }
        .event-screen-timer { font-size:13px; color:#ffd54f; }
        .event-back-btn {
            border:none;
            border-radius:10px;
            padding:8px 10px;
            background:#3949ab;
            color:#fff;
            font-weight:700;
        }
        .event-overlay-canvas-wrap {
            flex: 1;
            padding: 6px;
        }
        #event-canvas {
            width: 100%;
            height: 100%;
            touch-action: none;
            background: #fff;
            border-radius: 10px;
            display: block;
        }
        .event-overlay-footer {
            background: rgba(0,0,0,0.72);
            padding: 10px;
            font-size: 14px;
            font-weight: 700;
        }
        #paint-progress.paint-progress-win {
            background: linear-gradient(90deg, #ff4fa3, #ff2f92);
            color: #fff;
            border-radius: 8px;
            padding: 6px 10px;
            animation: paintWinBlink 0.7s infinite alternate;
            box-shadow: 0 0 14px rgba(255, 64, 129, 0.7);
        }
        @keyframes paintWinBlink {
            from { opacity: 0.65; transform: scale(1); }
            to { opacity: 1; transform: scale(1.02); }
        }
        #event-done-message { color: #9cffb2; margin-top: 4px; }
        .event-overlay[style*="display: flex"] { display:flex !important; }
    `;
  document.head.appendChild(style);
})();
