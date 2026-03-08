(function () {
    const itemTypes = {
        goldenPollen: {
            emoji: '🎇',
            name: 'Золотая пыльца',
            description: 'Даёт +1 билет к следующему получению билетов (одноразово).'
        },
        inkSaboteur: {
            emoji: '🫧',
            name: 'Клякса-саботаж',
            description: 'Позволяет выбрать игроку усложнение для следующей работы.'
        },
        magicWand: {
            emoji: '🎆',
            name: 'Волшебная палочка',
            description: 'Даёт упрощение задания на текущий раунд.'
        },
        magnifier: {
            emoji: '🔎',
            name: 'Лупа',
            description: 'Помогает в игровых механиках, где разрешено её использование.'
        }
    };

    const inkChallengeOptions = [
        'Отжимание: 10 приседаний + 10 прыжков',
        'Смена руки: рисуй нерабочей рукой',
        'Без контура: запрещено использовать чёрный/контур',
        '24 часа: работа должна быть сдана в течение 24 часов'
    ];

    window.itemTypes = itemTypes;
    window.inkChallengeOptions = inkChallengeOptions;
})();
