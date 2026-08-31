(function() {
    'use strict';

    const getClosestElement = (target, selector) => {
        const isTextNode = typeof Node !== 'undefined' && target?.nodeType === Node.TEXT_NODE;
        const element = isTextNode ? target.parentElement : target;
        return element && typeof element.closest === 'function' ? element.closest(selector) : null;
    };

    // --- 0. 설정 및 상수 (CONFIG) ---
    const CONFIG = {
        // 한국인 기준 (대한비만학회 2020)
        BMI: { 
            UNDER: 18.5, 
            NORMAL_END: 23, 
            PRE_OBESE_END: 25, 
            OBESE_1_END: 30, 
            OBESE_2_END: 35 
        }, 
        LIMITS: { MIN_WEIGHT: 30, MAX_WEIGHT: 300, MIN_FAT: 1, MAX_FAT: 70 },
        // CSS 변수명과 매핑되는 차트 색상값
        COLORS: {
            GAIN: 'var(--heatmap-gain)', // #ffcdd2
            LOSS: 'var(--secondary)',    // #bbdefb
            WEEKEND: '#F44336', 
            WEEKDAY: '#4CAF50'
        },
        // 복싱 체급 기준
        WEIGHT_CLASSES: [
            { name: "헤비급", min: 90.7 },
            { name: "크루저급", min: 79.4 },
            { name: "라이트헤비급", min: 76.2 },
            { name: "슈퍼미들급", min: 72.6 },
            { name: "미들급", min: 69.9 },
            { name: "슈퍼웰터급", min: 66.7 },
            { name: "웰터급", min: 63.5 },
            { name: "슈퍼라이트급", min: 61.2 },
            { name: "라이트급", min: 59.0 },
            { name: "슈퍼페더급", min: 57.2 },
            { name: "페더급", min: 55.3 },
            { name: "슈퍼밴텀급", min: 53.5 },
            { name: "밴텀급", min: 52.2 },
            { name: "슈퍼플라이급", min: 50.8 },
            { name: "플라이급", min: 49.0 },
            { name: "라이트플라이급", min: 47.6 },
            { name: "미니멈급", min: 0 }
        ],
        // 문자열 상수
        MESSAGES: {
            ANALYSIS: {
                LOSS: "어제보다 {diff}kg 빠졌습니다! 이대로 쭉 가봅시다! 🔥",
                GAIN: "약간 증량({diff}kg)했지만 괜찮습니다. 장기적인 추세가 중요합니다.",
                MAINTAIN: "체중 유지 중입니다. 꾸준함이 답입니다.",
                DATA_Need: "데이터가 2개 이상 쌓이면 분석을 시작합니다. 화이팅!"
            },
            PERSONA: {
                ROLLER: "🎢 롤러코스터형 (변동이 큽니다)",
                TURTLE: "🐢 꾸준한 거북이형 (안정적입니다)",
                BALANCE: "🏃 밸런스형 (적당한 변동)",
                WEEKEND: "🍻 주말 폭식형 (월요일 급증 주의)",
                RABBIT: "🐰 토끼형 (급빠급찐)"
            },
            TIPS: [
                "단백질 섭취량을 체중 1kg당 1.5g 이상으로 늘려보세요.",
                "하루 물 섭취량을 500ml 더 늘려보세요.",
                "운동 강도를 높이거나 루틴을 완전히 바꿔보세요.",
                "치팅밀이나 간식을 완전히 끊어보세요.",
                "수면 시간을 1시간 늘려보세요.",
                "간헐적 단식 시간을 2시간 더 늘려보세요."
            ],
            PLATEAU: {
                DETECTED: "🛑 <strong>정체기 감지!</strong> 최근 2주간 변화가 {diff}kg 입니다.<br>💡 팁: {tip}",
                GOOD: "📉 현재 감량 흐름이 좋습니다! 이대로 유지하세요!",
                WARN: "📈 약간의 증량이 있지만, 일시적인 현상일 수 있습니다.",
                NEED_DATA: "데이터가 충분하지 않습니다. 7일 이상 기록해주세요."
            }
        },
        // 의학 근거 기반 서술형 분석 리포트 참고문헌 라이브러리
        MEDICAL_EVIDENCE: [
            {
                key: 'KSSO_DIAG_2022',
                label: 'KSSO 2022 진단',
                year: '2023',
                title: 'Diagnosis of Obesity: 2022 Update of Clinical Practice Guidelines for Obesity by the Korean Society for the Study of Obesity',
                source: 'Journal of Obesity & Metabolic Syndrome',
                url: 'https://www.jomes.org/journal/view.html?doi=10.7570/jomes23031',
                note: '한국 성인 비만 전 단계와 비만의 BMI 기준 및 허리둘레 보조 평가 근거.'
            },
            {
                key: 'KSSO_MGMT_2020',
                label: 'KSSO 2020 관리',
                year: '2021',
                title: '2020 Korean Society for the Study of Obesity Guidelines for the Management of Obesity in Korea',
                source: 'Journal of Obesity & Metabolic Syndrome',
                url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8277596/',
                note: '6개월 5~10% 감량 목표, 영양치료, 신체활동 등 한국 비만 관리 지침.'
            },
            {
                key: 'USPSTF_BEHAVIOR_2018',
                label: 'USPSTF 2018',
                year: '2018',
                title: 'Behavioral Weight Loss Interventions to Prevent Obesity-Related Morbidity and Mortality in Adults',
                source: 'JAMA / USPSTF',
                url: 'https://jamanetwork.com/journals/jama/fullarticle/2702878',
                note: '성인 비만에서 집중적·다요소 행동중재 권고 근거.'
            },
            {
                key: 'CANADA_CPG_2020',
                label: 'Canada CPG 2020',
                year: '2020',
                title: 'Obesity in adults: a clinical practice guideline',
                source: 'Canadian Medical Association Journal',
                url: 'https://www.cmaj.ca/content/192/31/e875',
                note: 'BMI와 허리둘레, 만성질환 관점의 비만 평가 및 장기 관리 프레임.'
            },
            {
                key: 'WHO_PA_2020',
                label: 'WHO 2020 운동',
                year: '2020',
                title: 'WHO guidelines on physical activity and sedentary behaviour',
                source: 'World Health Organization / BJSM',
                url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7719906/',
                note: '성인 주 150~300분 중강도 유산소 또는 75~150분 고강도 운동과 주 2회 이상 근력운동 권고.'
            },
            {
                key: 'SELF_MONITOR_2024',
                label: '체중 자기모니터링',
                year: '2024',
                title: 'Self-Monitoring of Weight as a Weight Loss Strategy',
                source: 'Current Obesity Reports',
                url: 'https://link.springer.com/article/10.1007/s12170-024-00746-5',
                note: '정기적 체중 자기모니터링 빈도와 감량 성공의 관련성.'
            },
            {
                key: 'VUORINEN_2021',
                label: 'JMIR 2021 기록 빈도',
                year: '2021',
                title: 'Frequency of Self-Weighing and Weight Change',
                source: 'Journal of Medical Internet Research',
                url: 'https://www.jmir.org/2021/6/e25529/',
                note: '자유생활 환경에서도 잦은 체중 측정이 더 유리한 감량 결과와 관련.'
            },
            {
                key: 'LONGLAND_2016',
                label: '단백질·운동 RCT',
                year: '2016',
                title: 'Higher compared with lower dietary protein during an energy deficit combined with intense exercise promotes greater lean mass gain and fat mass loss',
                source: 'American Journal of Clinical Nutrition',
                url: 'https://pubmed.ncbi.nlm.nih.gov/26817506/',
                note: '에너지 제한 중 높은 단백질과 운동이 제지방량 보존·체지방 감량에 유리했던 무작위시험.'
            },
            {
                key: 'VERREIJEN_2017',
                label: '고단백·저항운동',
                year: '2017',
                title: 'Effect of a high protein diet and/or resistance exercise on the preservation of fat free mass during weight loss',
                source: 'Nutrition Journal',
                url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5294725/',
                note: '과체중·비만 성인의 감량 중 제지방량 보존과 저항운동·단백질 전략 근거.'
            },
            {
                key: 'SLEEP_EXTENSION_2022',
                label: '수면 연장 RCT',
                year: '2022',
                title: 'Effect of Sleep Extension on Objectively Assessed Energy Intake Among Adults With Overweight in Real-life Settings',
                source: 'JAMA Internal Medicine',
                url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8822469/',
                note: '짧게 자는 과체중 성인에서 수면 연장이 에너지 섭취 감소와 음의 에너지 균형에 기여한 임상시험.'
            },
            {
                key: 'WEIGHT_VARIABILITY_2023',
                label: '체중 변동성 메타분석',
                year: '2023',
                title: 'Weight variability and cardiovascular outcomes: a systematic review and meta-analysis',
                source: 'Cardiovascular Diabetology',
                url: 'https://link.springer.com/article/10.1186/s12933-022-01735-x',
                note: '장기 체중 변동성과 심혈관 위험의 관련성을 다룬 체계적 문헌고찰·메타분석.'
            },
            {
                key: 'WAIST_2020',
                label: '허리둘레 vital sign',
                year: '2020',
                title: 'Waist circumference as a vital sign in clinical practice',
                source: 'Nature Reviews Endocrinology',
                url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7027970/',
                note: 'BMI만으로 부족한 복부 비만·대사 위험 평가에서 허리둘레 측정의 중요성.'
            },
            {
                key: 'HALL_UPF_2019',
                label: '초가공식품 RCT',
                year: '2019',
                title: 'Ultra-processed diets cause excess calorie intake and weight gain: an inpatient randomized controlled trial of ad libitum food intake',
                source: 'Cell Metabolism',
                url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7946062/',
                note: '식품 가공도와 자유 섭취 에너지, 체중 변화의 인과 가능성을 평가한 입원 교차 무작위시험.'
            },
            {
                key: 'LOWE_TRE_2020',
                label: 'TRE 2020 RCT',
                year: '2020',
                title: 'Effects of Time-Restricted Eating on Weight Loss and Other Metabolic Parameters in Women and Men With Overweight and Obesity',
                source: 'JAMA Internal Medicine',
                url: 'https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/2771095',
                note: '16:8 시간제한식이 단독으로 체중·대사지표 이득을 확실히 보이지 않았던 무작위시험.'
            },
            {
                key: 'TRE_NEJM_2022',
                label: 'TRE NEJM 2022',
                year: '2022',
                title: 'Calorie Restriction with or without Time-Restricted Eating in Weight Loss',
                source: 'New England Journal of Medicine',
                url: 'https://www.nejm.org/doi/full/10.1056/NEJMoa2114833',
                note: '비만 성인에서 열량 제한에 시간제한식을 더해도 체중·체지방·대사 위험 감소가 추가로 커지지 않았던 임상시험.'
            },
            {
                key: 'EARLY_TRE_2022',
                label: 'eTRE 2022 RCT',
                year: '2022',
                title: 'Effectiveness of Early Time-Restricted Eating for Weight Loss, Fat Loss, and Cardiometabolic Health in Adults With Obesity',
                source: 'JAMA Internal Medicine',
                url: 'https://pubmed.ncbi.nlm.nih.gov/35939311/',
                note: '초기 시간대 식사 제한이 일부 체중·혈압·기분 지표에서 유리할 수 있음을 보인 14주 무작위시험.'
            },
            {
                key: 'MORTON_PROTEIN_2018',
                label: '단백질·저항운동 메타분석',
                year: '2018',
                title: 'A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength',
                source: 'British Journal of Sports Medicine',
                url: 'https://pubmed.ncbi.nlm.nih.gov/28698222/',
                note: '저항운동 중 단백질 보충과 근육량·근력 적응의 관련성을 정량화한 대규모 메타분석.'
            },
            {
                key: 'PROTEIN_META_2024',
                label: '단백질 메타분석',
                year: '2024',
                title: 'Enhanced protein intake on maintaining muscle mass, strength, and physical function in adults with overweight/obesity',
                source: 'Clinical Nutrition ESPEN',
                url: 'https://pubmed.ncbi.nlm.nih.gov/39002131/',
                note: '과체중·비만 성인의 감량 중 높은 단백질 섭취가 근육량 감소 억제와 관련된 체계적 문헌고찰·메타분석.'
            },
            {
                key: 'RESISTANCE_META_2022',
                label: '저항운동 메타분석',
                year: '2022',
                title: 'Resistance training effectiveness on body composition and body weight outcomes in individuals with overweight and obesity across the lifespan',
                source: 'Obesity Reviews',
                url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9285060/',
                note: '열량 제한 중 저항운동이 제지방량 보존과 체성분 관리에 중요함을 다룬 체계적 문헌고찰·메타분석.'
            },
            {
                key: 'BMJ_PRIMARYCARE_2022',
                label: '일차진료 행동중재',
                year: '2022',
                title: 'Effectiveness of behavioural weight management interventions for adults with obesity delivered in primary care',
                source: 'BMJ',
                url: 'https://www.bmj.com/content/377/bmj-2021-069719',
                note: '일차진료 기반 행동 체중관리 중재 효과를 평가한 체계적 문헌고찰·메타분석.'
            },
            {
                key: 'MAINTENANCE_2022',
                label: '감량 유지 메타분석',
                year: '2022',
                title: 'Weight Maintenance after Dietary Weight Loss: Systematic Review and Meta-Analysis on the Effectiveness of Behavioural Intensive Intervention',
                source: 'Nutrients',
                url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8953094/',
                note: '감량 후 유지 단계에서 행동중재가 체중 재증가를 줄이는지 평가한 체계적 문헌고찰·메타분석.'
            },
            {
                key: 'HALL_MAINTENANCE_2018',
                label: '장기 유지 리뷰',
                year: '2018',
                title: 'Maintenance of lost weight and long-term management of obesity',
                source: 'Medical Clinics of North America',
                url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5764193/',
                note: '감량 후 체중 재증가가 흔하며 장기 관리가 필요하다는 생리·행동학적 근거 정리.'
            },
            {
                key: 'EATING_DISORDER_2023',
                label: '섭식장애 위험',
                year: '2023',
                title: 'Eating disorder risk during behavioral weight management in adults with overweight or obesity',
                source: 'Obesity Reviews',
                url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10909435/',
                note: '체중관리 중재와 섭식장애 위험을 함께 고려해야 함을 다룬 체계적 문헌고찰.'
            },
            {
                key: 'GALLSTONE_2021',
                label: '담석 위험 리뷰',
                year: '2021',
                title: 'Excess Body Weight and Gallstone Disease',
                source: 'Visceral Medicine',
                url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8406364/',
                note: '비만과 빠른 체중감량이 담석 형성과 관련될 수 있음을 정리한 임상 리뷰.'
            },
            {
                key: 'NICE_OBESITY_2025',
                label: 'NICE NG246',
                year: '2025',
                title: 'Overweight and obesity management',
                source: 'National Institute for Health and Care Excellence',
                url: 'https://www.nice.org.uk/guidance/ng246',
                note: '과체중·비만·중심성 비만의 예방과 관리, 평가와 의뢰 원칙을 통합한 최신 지침.'
            }
        ],
        // 뱃지 정의
        BADGES: [
            { id: 'start', name: '시작이 반', icon: '🐣', desc: '첫 기록을 남겼습니다.' },
            { id: 'holiday', name: '홀리데이 서바이버', icon: '🎅', desc: '명절/연말 전후 증량을 0.5kg 미만으로 막아냈습니다.' },
            { id: 'zombie', name: '돌아온 탕아', icon: '🧟', desc: '15일 이상의 공백을 깨고 다시 기록을 시작했습니다.' },
            { id: 'sniper', name: '스나이퍼', icon: '🎯', desc: '목표 체중을 소수점까지 정확하게 명중시켰습니다.' },
            { id: 'coaster', name: '롤러코스터', icon: '🎢', desc: '하루 만에 1.5kg 이상의 급격한 변화를 경험했습니다.' },
            { id: 'zen', name: '평정심', icon: '🧘', desc: '7일 연속으로 체중 변동 폭이 0.1kg 이내로 유지되었습니다.' },
            { id: 'loss3', name: '3kg 감량', icon: '🥉', desc: '총 3kg 이상 감량했습니다.' },
            { id: 'loss5', name: '5kg 감량', icon: '🥈', desc: '총 5kg 이상 감량했습니다.' },
            { id: 'loss10', name: '10kg 감량', icon: '🥇', desc: '총 10kg 이상 감량했습니다.' },
            { id: 'streak3', name: '작심삼일 탈출', icon: '🔥', desc: '3일 연속으로 감량 또는 유지했습니다.' },
            { id: 'streak7', name: '일주일 연속', icon: '⚡', desc: '7일 연속으로 감량 또는 유지했습니다.' },
            { id: 'digit', name: '앞자리 체인지', icon: '✨', desc: '체중의 십의 자리 숫자가 바뀌었습니다.' },
            { id: 'goal', name: '목표 달성', icon: '👑', desc: '최종 목표 체중에 도달했습니다.' },
            { id: 'weekend', name: '주말 방어전', icon: '🛡️', desc: '주말(토~월) 동안 체중이 늘지 않았습니다.' },
            { id: 'plateau', name: '정체기 탈출', icon: '🧗‍♀️', desc: '7일 이상의 정체기를 뚫고 감량했습니다.' },
            { id: 'bmi', name: 'BMI 돌파', icon: '🩸', desc: 'BMI 단계(비만->과체중->정상)가 개선되었습니다.' },
            { id: 'yoyo', name: '요요 방지턱', icon: '🧘', desc: '목표 달성 후 10일간 체중을 유지했습니다.' },
            { id: 'ottogi', name: '오뚜기', icon: '💪', desc: '급격한 증량 후 3일 내에 다시 복구했습니다.' },
            { id: 'recordGod', name: '기록의 신', icon: '📝', desc: '총 누적 기록 365개를 달성했습니다.' },
            { id: 'goldenCross', name: '골든 크로스', icon: '📉', desc: '급격한 하락 추세(30일 평균 대비 7일 평균 급감)에 진입했습니다.' },
            { id: 'fatDestroyer', name: '체지방 파괴자', icon: '🥓', desc: '체지방률 25% 미만에 진입했습니다.' },
            { id: 'plateauMaster', name: '정체기 끝판왕', icon: '🧱', desc: '7일 이상 변동 없다가 0.5kg 이상 감량했습니다.' },
            { id: 'recordMaster', name: '기록의 달인', icon: '📅', desc: '90일 연속으로 기록했습니다.' },
            { id: 'reborn', name: '다시 태어난', icon: '🦋', desc: '최고 체중에서 10kg 이상 감량했습니다.' },
            { id: 'slowSteady', name: '슬로우 앤 스테디', icon: '🐢', desc: '3개월간 월평균 2kg 이하로 꾸준히 감량했습니다.' },
            { id: 'weightExpert', name: '체중 변화 전문가', icon: '🎓', desc: '1개월간 4kg 이상 감량했습니다.' },
            { id: 'plateauDestroyer', name: '정체기 파괴자', icon: '🔨', desc: '2주 이상의 정체기를 극복했습니다.' },
            { id: 'iconOfConstancy', name: '꾸준함의 아이콘', icon: '🗿', desc: '6개월 이상 연속 기록을 유지했습니다.' },
            { id: 'bigStep', name: '빅 스텝', icon: '👣', desc: '하루 만에 1.0kg 이상 감량했습니다.' },
            { id: 'phoenix', name: '불사조', icon: '🐦‍🔥', desc: '요요(증량) 후 다시 심기일전하여 최저 체중을 경신했습니다.' },
            { id: 'weekendRuler', name: '주말의 지배자', icon: '🧛', desc: '금요일 아침보다 월요일 아침 체중이 같거나 낮았습니다.' },
            { id: 'curiosity', name: '궁금증 해결사', icon: '🕵️', desc: '체지방률을 안 재다가 10일 연속으로 꼼꼼히 기록했습니다.' },
            { id: 'timeTraveler', name: '시공간 초월', icon: '🚀', desc: '예상 완료일을 10일 이상 앞당겼습니다.' },
            { id: 'parking', name: '주차의 달인', icon: '🅿️', desc: '14일 동안 체중 변동 폭이 ±0.3kg 이내로 유지되었습니다.' },
            { id: 'whoosh', name: '후루룩', icon: '📉', desc: '정체기 직후 하루 만에 0.8kg 이상 감량되었습니다.' },
            { id: 'fullMoon', name: '보름달', icon: '🌕', desc: '한 달(30일) 동안 하루도 빠짐없이 기록했습니다.' },
            { id: 'lucky7', name: '럭키 세븐', icon: '🎰', desc: '체중의 소수점 자리가 .7 또는 .77로 끝납니다.' },
            { id: 'ironWall', name: '철벽 방어', icon: '🧱', desc: '최고 체중 직전에서 다시 감량했습니다.' },
            { id: 'seasonality', name: '시즌 플레이어', icon: '🗓️', desc: '4계절(3, 6, 9, 12월)에 모두 기록이 존재합니다.' },
            // v3.0.57 추가
            { id: 'decalcomania', name: '데칼코마니', icon: '🪞', desc: '이틀 연속 체중이 소수점까지 완전히 똑같습니다.' },
            { id: 'cleaning', name: '대청소', icon: '🧹', desc: '체지방 감량량이 총 체중 감량량보다 큽니다. (이상적 감량)' },
            { id: 'gyroDrop', name: '자이로드롭', icon: '📉', desc: '하루 만에 1.0kg 이상 빠졌습니다.' },
            { id: 'weekendSniper', name: '주말의 명사수', icon: '🗓️', desc: '금요일 체중보다 월요일 체중이 더 낮습니다.' },
            { id: 'piMiracle', name: '파이(π)의 기적', icon: '🔢', desc: '3.14kg 감량했거나 체중이 .14로 끝납니다.' },
            // v3.0.67 추가
            { id: 'palindrome', name: '회문 마스터', icon: '🪞', desc: '체중이 78.87, 65.56 처럼 앞뒤가 똑같은 숫자입니다.' },
            { id: 'anniversary', name: '기념일 챙기기', icon: '🎉', desc: '기록 시작 100일, 1주년 또는 1000일을 달성했습니다.' },
            // v3.0.71 추가
            { id: 'breakMaster', name: '브레이크 마스터', icon: '🛑', desc: '폭식(급증) 후 다음날 즉시 50% 이상을 복구했습니다.' },
            { id: 'weekendVictory', name: '주말 방어전 승리', icon: '🗓️', desc: '금요일 체중보다 월요일 체중이 더 낮거나 같습니다.' },
            { id: 'maintainerQual', name: '유지어터의 자질', icon: '🧘', desc: '감량 없이 ±0.2kg 범위 내에서 10일 이상 머물렀습니다.' },
            { id: 'wallBreaker', name: '마의 구간 돌파', icon: '📉', desc: '가장 오래 머물렀던 체중 구간을 뚫고 내려갔습니다.' }
        ]
    };

    // --- 0.1 유틸리티 (DateUtil, MathUtil, DomUtil) ---
    const DateUtil = {
        parse: (str) => {
            if (!str) return null;
            const parts = str.split('-');
            return new Date(parts[0], parts[1] - 1, parts[2]);
        },
        format: (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        },
        daysBetween: (d1, d2) => {
            const startDate = d1 instanceof Date ? d1 : new Date(d1);
            const endDate = d2 instanceof Date ? d2 : new Date(d2);
            const startDay = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const endDay = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            return (endDay - startDay) / 86400000;
        },
        addDays: (dateStr, days) => {
            const d = DateUtil.parse(dateStr);
            d.setDate(d.getDate() + days);
            return DateUtil.format(d);
        },
        isFuture: (dateStr) => {
            const inputDate = DateUtil.parse(dateStr);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return inputDate > today;
        },
        getDaysInMonth: (year, month) => {
            return new Date(year, month + 1, 0).getDate();
        },
        addMonthsClamped: (date, months) => {
            const shiftedDate = date instanceof Date ? new Date(date.getTime()) : new Date(date);
            const monthOffset = Number(months);
            if (Number.isNaN(shiftedDate.getTime()) || !Number.isInteger(monthOffset)) return null;

            // Date#setMonth()는 3월 31일에서 한 달을 빼면 2월 말이 아니라
            // 다시 3월로 넘칠 수 있습니다. 먼저 1일로 이동한 뒤 대상 월의
            // 말일에 맞춰 원래 일자를 제한해 월간 필터 경계를 보존합니다.
            const originalDay = shiftedDate.getDate();
            shiftedDate.setDate(1);
            shiftedDate.setMonth(shiftedDate.getMonth() + monthOffset);
            shiftedDate.setDate(Math.min(
                originalDay,
                DateUtil.getDaysInMonth(shiftedDate.getFullYear(), shiftedDate.getMonth())
            ));
            return shiftedDate;
        },
        addYearsClamped: (date, years) => {
            const yearOffset = Number(years);
            if (!Number.isInteger(yearOffset)) return null;
            return DateUtil.addMonthsClamped(date, yearOffset * 12);
        },
        getWeekNumber: (d) => {
            d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
            var yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
            var weekNo = Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
            return weekNo;
        },
        isValidDateString: (str) => {
            if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
            const parsed = DateUtil.parse(str);
            return parsed instanceof Date && !isNaN(parsed.getTime()) && DateUtil.format(parsed) === str;
        }
    };

    const isNextCalendarDay = (previousRecord, currentRecord) => {
        if (!previousRecord || !currentRecord) return false;
        const previousDate = DateUtil.parse(previousRecord.date);
        const currentDate = DateUtil.parse(currentRecord.date);
        return previousDate instanceof Date
            && currentDate instanceof Date
            && !Number.isNaN(previousDate.getTime())
            && !Number.isNaN(currentDate.getTime())
            && DateUtil.daysBetween(previousDate, currentDate) === 1;
    };

    const isConsecutiveDailyRecordRange = (records) => (
        Array.isArray(records)
        && records.length > 0
        && records.every((record, index) => index === 0 || isNextCalendarDay(records[index - 1], record))
    );

    const getLongestConsecutiveRecordRun = (records) => {
        if (!Array.isArray(records) || records.length === 0) return 0;

        let longestRun = 1;
        let currentRun = 1;
        for (let index = 1; index < records.length; index++) {
            currentRun = isNextCalendarDay(records[index - 1], records[index])
                ? currentRun + 1
                : 1;
            longestRun = Math.max(longestRun, currentRun);
        }
        return longestRun;
    };

    const hasConsecutivePlateauBreak = (records, minimumStableDays, minimumDrop = Number.EPSILON) => {
        if (!Array.isArray(records) || records.length < minimumStableDays + 1) return false;

        let stableRecordCount = 1;
        for (let index = 1; index < records.length; index++) {
            if (!isNextCalendarDay(records[index - 1], records[index])) {
                stableRecordCount = 1;
                continue;
            }

            const change = records[index].weight - records[index - 1].weight;
            if (Math.abs(change) < 0.2) {
                stableRecordCount += 1;
                continue;
            }

            if (stableRecordCount >= minimumStableDays && -change >= minimumDrop) {
                return true;
            }
            stableRecordCount = 1;
        }
        return false;
    };

    const MathUtil = {
        round: (num, decimals = 1) => {
            if (num === null || num === undefined) return 0;
            const factor = Math.pow(10, decimals);
            return Math.round((num + Number.EPSILON) * factor) / factor;
        },
        diff: (a, b) => MathUtil.round(a - b),
        add: (a, b) => MathUtil.round(a + b),
        clamp: (num, min, max) => Math.min(Math.max(num, min), max),
        stdDev: (arr) => {
            if (arr.length === 0) return 0;
            const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
            const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
            return Math.sqrt(variance);
        },
        mean: (arr) => arr.length ? arr.reduce((a,b)=>a+b, 0) / arr.length : 0
    };

    let warnedAboutMissingRichHtmlSanitizer = false;
    const DomUtil = {
        escapeHtml: (text) => {
            if (window.MothNoteSanitizer?.escapeHtml) {
                return window.MothNoteSanitizer.escapeHtml(text);
            }
            if (text === null || text === undefined) return '';
            return String(text)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        },
        setSafeHtml: (element, html) => {
            if (!element) return;
            const value = String(html ?? '');
            if (!value) {
                element.textContent = '';
                return;
            }
            if (window.MothNoteSanitizer?.setSanitizedRichHtml) {
                window.MothNoteSanitizer.setSanitizedRichHtml(element, value);
                return;
            }
            // Sanitizer를 사용할 수 없는 환경에서는 HTML을 해석하지 않고 텍스트로 표시합니다.
            // 리치 마크업은 사라지지만, 예외 상황에서도 스크립트 실행 가능성을 열어두지 않습니다.
            if (!warnedAboutMissingRichHtmlSanitizer) {
                console.warn('MothNoteSanitizer를 찾을 수 없어 리치 HTML을 텍스트로 표시합니다.');
                warnedAboutMissingRichHtmlSanitizer = true;
            }
            element.textContent = value;
        },
        getChartColors: () => {
            const styles = getComputedStyle(document.body);
            return {
                grid: styles.getPropertyValue('--chart-grid').trim(),
                text: styles.getPropertyValue('--chart-text').trim(),
                primary: styles.getPropertyValue('--primary').trim(),
                secondary: styles.getPropertyValue('--secondary').trim(),
                danger: styles.getPropertyValue('--danger').trim(),
                accent: styles.getPropertyValue('--accent').trim()
            };
        },
        setTextColor: (el, colorType) => {
            if (!el) return;
            el.className = el.className.replace(/\btext-\S+/g, '');
            if (colorType === 'danger') el.classList.add('text-danger');
            else if (colorType === 'primary') el.classList.add('text-primary');
            else if (colorType === 'secondary') el.classList.add('text-secondary');
            else if (colorType === 'accent') el.classList.add('text-accent');
            else if (colorType === 'default') el.classList.add('text-default');
        },
        getTemplate: (id) => document.getElementById(id),
        clearAndAppend: (element, fragment) => {
            if (!element) return;
            element.innerHTML = '';
            element.appendChild(fragment);
        }
    };

    const debounce = (func, delay) => {
        let timer = null;
        let pendingArgs = null;
        let pendingThis = null;

        const debounced = function(...args) {
            pendingArgs = args;
            pendingThis = this;
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => {
                const callArgs = pendingArgs || [];
                const callThis = pendingThis;
                timer = null;
                pendingArgs = null;
                pendingThis = null;
                func.apply(callThis, callArgs);
            }, delay);
        };

        // 페이지가 숨겨지거나 닫힐 때 아직 대기 중인 마지막 저장을 즉시 실행할 수 있게 합니다.
        debounced.flush = () => {
            if (timer === null) return false;
            clearTimeout(timer);
            const callArgs = pendingArgs || [];
            const callThis = pendingThis;
            timer = null;
            pendingArgs = null;
            pendingThis = null;
            func.apply(callThis, callArgs);
            return true;
        };

        debounced.cancel = () => {
            if (timer !== null) clearTimeout(timer);
            timer = null;
            pendingArgs = null;
            pendingThis = null;
        };

        return debounced;
    };

    const getFileReaderText = (event) => {
        const result = event?.target?.result;
        return typeof result === 'string' ? result.trim().replace(/^\uFEFF/, '') : '';
    };

    // --- 1. 상태 및 DOM 관리 ---
    const AppState = {
        STORAGE_KEY: 'diet_pro_records',
        SETTINGS_KEY: 'diet_pro_settings',
        INLINE_EDIT_DRAFT_KEY: 'diet_pro_inline_edit_draft',
        FILTER_KEY: 'diet_pro_filter_mode',
        CUSTOM_FILTER_START_KEY: 'diet_pro_filter_custom_start',
        CUSTOM_FILTER_END_KEY: 'diet_pro_filter_custom_end',
        records: [],
        settings: { height: 179, startWeight: 78.5, goal1: 70, intake: 1862 },
        chartFilterMode: 'ALL',
        customStart: null,
        customEnd: null,
        // charts 객체는 차트 인스턴스 추적용
        charts: {},
        _elCache: {},
        getEl: function(id) {
            if (!this._elCache[id]) {
                this._elCache[id] = document.getElementById(id);
            }
            return this._elCache[id];
        },
        state: {
            editingDate: null,
            inlineEditDraft: null,
            statsCache: null,
            isDirty: true,
            calendarViewDate: new Date(),
            medicalNarrativePlainText: '',
            hasRenderedNonEmptyRecords: false,
            recordsLoadFailed: false
        }
    };

    // JSON/CSV 복원은 같은 기록 저장소를 갱신합니다. 두 FileReader가 겹치면
    // 먼저 성공한 복원 결과를 늦게 끝난 작업이 다시 덮어쓸 수 있으므로,
    // 파일 읽기 시작부터 저장·화면 갱신 완료까지 하나의 작업만 허용합니다.
    let dietImportOperationInProgress = false;
    const setDietImportControlsDisabled = (disabled) => {
        ['btn-import-json', 'btn-import-csv', 'jsonFileInput', 'csvImportInput'].forEach(id => {
            const element = AppState.getEl(id);
            if (element) element.disabled = disabled;
        });
    };
    const beginDietImport = () => {
        if (dietImportOperationInProgress) {
            showToast('이미 다른 데이터 복원이 진행 중입니다. 현재 작업이 끝난 뒤 다시 시도해주세요.');
            return false;
        }
        dietImportOperationInProgress = true;
        setDietImportControlsDisabled(true);
        return true;
    };
    const finishDietImport = () => {
        dietImportOperationInProgress = false;
        setDietImportControlsDisabled(false);
    };

    // JSON boolean/배열/객체가 Number()에서 숫자로 바뀌는 타입 혼동을 막습니다.
    // 기존 숫자 문자열과 실제 숫자만 허용해 레거시 호환성은 유지합니다.
    const parseFiniteNumericScalar = (value) => {
        if (typeof value !== 'number' && typeof value !== 'string') return null;
        if (typeof value === 'string' && value.trim() === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    };

    const sanitizeDietRecord = (raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const date = String(raw.date ?? '').trim();
        if (!DateUtil.isValidDateString(date) || DateUtil.isFuture(date)) return null;

        const weight = parseFiniteNumericScalar(raw.weight);
        if (weight === null || weight < CONFIG.LIMITS.MIN_WEIGHT || weight > CONFIG.LIMITS.MAX_WEIGHT) return null;

        const record = { date, weight: MathUtil.round(weight) };
        const hasFat = raw.fat !== undefined && raw.fat !== null && String(raw.fat).trim() !== '';
        if (hasFat) {
            const fat = parseFiniteNumericScalar(raw.fat);
            if (fat !== null && fat >= CONFIG.LIMITS.MIN_FAT && fat <= CONFIG.LIMITS.MAX_FAT) {
                record.fat = MathUtil.round(fat);
            }
        }
        return record;
    };

    const sanitizeDietRecords = (records) => {
        const byDate = new Map();
        if (!Array.isArray(records)) return [];
        records.forEach(raw => {
            const record = sanitizeDietRecord(raw);
            if (record) byDate.set(record.date, record);
        });
        return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    };

    const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

    const normalizeImportedDietRecords = (records) => {
        if (!Array.isArray(records)) {
            return { ok: false, records: [], error: 'records 항목은 배열이어야 합니다.' };
        }

        const normalizedRecords = [];
        const seenDates = new Set();

        for (let index = 0; index < records.length; index++) {
            const rawRecord = records[index];
            if (!isPlainObject(rawRecord)) {
                return { ok: false, records: [], error: `${index + 1}번째 기록의 형식이 올바르지 않습니다.` };
            }

            const normalizedRecord = sanitizeDietRecord(rawRecord);
            if (!normalizedRecord) {
                return { ok: false, records: [], error: `${index + 1}번째 기록의 날짜 또는 체중이 유효하지 않습니다.` };
            }

            const hasFatValue = rawRecord.fat !== undefined
                && rawRecord.fat !== null
                && String(rawRecord.fat).trim() !== '';
            if (hasFatValue && !Object.prototype.hasOwnProperty.call(normalizedRecord, 'fat')) {
                return { ok: false, records: [], error: `${index + 1}번째 기록의 체지방률이 유효하지 않습니다.` };
            }

            if (seenDates.has(normalizedRecord.date)) {
                return { ok: false, records: [], error: `${normalizedRecord.date} 날짜가 중복되어 있습니다.` };
            }

            seenDates.add(normalizedRecord.date);
            normalizedRecords.push(normalizedRecord);
        }

        normalizedRecords.sort((a, b) => a.date.localeCompare(b.date));
        return { ok: true, records: normalizedRecords, error: '' };
    };

    const sanitizeDietSettings = (settings) => {
        const defaults = { height: 179, startWeight: 78.5, goal1: 70, intake: 1862 };
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { ...defaults };
        const height = parseFiniteNumericScalar(settings.height);
        const startWeight = parseFiniteNumericScalar(settings.startWeight);
        const goal1 = parseFiniteNumericScalar(settings.goal1);
        const intake = parseFiniteNumericScalar(settings.intake);
        return {
            height: height !== null && height > 0 && height <= 300 ? MathUtil.round(height) : defaults.height,
            startWeight: startWeight !== null && startWeight > 0 && startWeight <= 500 ? MathUtil.round(startWeight) : defaults.startWeight,
            goal1: goal1 !== null && goal1 > 0 && goal1 <= 500 ? MathUtil.round(goal1) : defaults.goal1,
            intake: intake !== null && intake >= 1 && intake <= 10000 ? Math.round(intake) : defaults.intake
        };
    };

    const normalizeImportedDietSettings = (settings, currentSettings) => {
        if (!isPlainObject(settings)) {
            return { ok: false, settings: null, error: 'settings 항목은 객체 형식이어야 합니다.' };
        }

        const current = sanitizeDietSettings(currentSettings);
        const rules = {
            height: { min: Number.EPSILON, max: 300, label: '키' },
            startWeight: { min: Number.EPSILON, max: 500, label: '시작 체중' },
            goal1: { min: Number.EPSILON, max: 500, label: '목표 체중' },
            intake: { min: 1, max: 10000, label: '하루 섭취 칼로리', integer: true }
        };
        const candidate = { ...current };

        for (const [key, rule] of Object.entries(rules)) {
            if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;

            const rawValue = settings[key];
            const numberValue = parseFiniteNumericScalar(rawValue);
            if (numberValue === null
                || numberValue < rule.min
                || numberValue > rule.max) {
                return {
                    ok: false,
                    settings: null,
                    error: `settings의 ${rule.label} 값이 올바르지 않습니다.`
                };
            }

            candidate[key] = rule.integer ? Math.round(numberValue) : MathUtil.round(numberValue);
        }

        return { ok: true, settings: candidate, error: '' };
    };

    const syncDietSettingsInputs = (settings) => {
        const fields = [
            ['userHeight', 'height'],
            ['startWeight', 'startWeight'],
            ['goal1Weight', 'goal1'],
            ['dailyIntake', 'intake']
        ];

        fields.forEach(([elementId, settingKey]) => {
            const input = AppState.getEl(elementId);
            if (input) input.value = settings[settingKey];
        });
    };

    const VALID_CHART_FILTER_MODES = new Set(['1M', '3M', '6M', '1Y', 'ALL', 'CUSTOM']);

    const sanitizeChartFilterMode = (mode) => VALID_CHART_FILTER_MODES.has(mode) ? mode : 'ALL';

    const cloneDietRecords = (records) => sanitizeDietRecords(records).map(record => ({ ...record }));

    const escapeCssAttributeValue = (value) => {
        const stringValue = String(value ?? '');
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
            return CSS.escape(stringValue);
        }
        return stringValue.split('').map((char) => {
            if (char === '\\') return '\\\\';
            if (char === '"') return '\\"';
            if (char === '\n' || char === '\r' || char === '\f') return ' ';
            return char;
        }).join('');
    };


    const parseCsvLineSafely = (line) => {
        const fields = [];
        let field = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (inQuotes) {
                if (char === '"') {
                    if (line[i + 1] === '"') {
                        field += '"';
                        i += 1;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    field += char;
                }
                continue;
            }

            if (char === '"' && field.length === 0) {
                inQuotes = true;
            } else if (char === ',') {
                fields.push(field);
                field = '';
            } else {
                field += char;
            }
        }

        fields.push(field);
        return fields;
    };

    const rollbackLocalStorageEntries = (previousEntries) => {
        previousEntries.forEach(({ key, hadValue, value }) => {
            try {
                if (hadValue) localStorage.setItem(key, value);
                else localStorage.removeItem(key);
            } catch (rollbackError) {
                console.error('Diet localStorage rollback failed:', rollbackError);
            }
        });
    };

    const persistLocalStorageEntriesAtomically = (entries, errorMessage = '데이터를 저장하지 못했습니다. 저장 공간 또는 브라우저 권한을 확인해주세요.') => {
        const previousEntries = [];
        try {
            entries.forEach(({ key }) => {
                const previousValue = localStorage.getItem(key);
                previousEntries.push({ key, hadValue: previousValue !== null, value: previousValue });
            });
            entries.forEach(({ key, value }) => localStorage.setItem(key, String(value)));
            return true;
        } catch (error) {
            console.error('Diet localStorage persistence failed:', error);
            rollbackLocalStorageEntries(previousEntries);
            showToast(errorMessage);
            return false;
        }
    };

    const DIET_RECORD_RECOVERY_REQUIRED_MESSAGE = '저장된 체중 기록이 손상되어 원본 보호를 위해 변경사항을 저장하지 않았습니다. 정상 JSON 백업을 복원하거나 데이터 초기화를 진행해주세요.';

    const persistDietRecordsImmediate = (records = AppState.records, { allowCorruptDataReplacement = false } = {}) => {
        if (AppState.state.recordsLoadFailed && !allowCorruptDataReplacement) {
            console.warn('Diet record save was blocked to preserve malformed stored data.');
            showToast(DIET_RECORD_RECOVERY_REQUIRED_MESSAGE);
            return false;
        }

        const safeRecords = sanitizeDietRecords(records);
        const didPersist = persistLocalStorageEntriesAtomically([
            { key: AppState.STORAGE_KEY, value: JSON.stringify(safeRecords) }
        ], '체중 기록을 저장하지 못했습니다. 저장 공간 또는 브라우저 권한을 확인해주세요.');
        if (didPersist && allowCorruptDataReplacement) AppState.state.recordsLoadFailed = false;
        return didPersist;
    };

    const persistDietSettingsImmediate = (settings = AppState.settings) => {
        const safeSettings = sanitizeDietSettings(settings);
        return persistLocalStorageEntriesAtomically([
            { key: AppState.SETTINGS_KEY, value: JSON.stringify(safeSettings) }
        ], '다이어트 설정을 저장하지 못했습니다. 저장 공간 또는 브라우저 권한을 확인해주세요.');
    };

    const persistDietStateSnapshot = (records, settings, { allowCorruptDataReplacement = false } = {}) => {
        if (AppState.state.recordsLoadFailed && !allowCorruptDataReplacement) {
            console.warn('Diet state import was blocked to preserve malformed stored records.');
            showToast(DIET_RECORD_RECOVERY_REQUIRED_MESSAGE);
            return false;
        }

        const safeRecords = sanitizeDietRecords(records);
        const safeSettings = sanitizeDietSettings(settings);
        const didPersist = persistLocalStorageEntriesAtomically([
            { key: AppState.STORAGE_KEY, value: JSON.stringify(safeRecords) },
            { key: AppState.SETTINGS_KEY, value: JSON.stringify(safeSettings) }
        ], '가져온 다이어트 데이터를 저장하지 못했습니다. 기존 데이터를 유지합니다.');
        if (didPersist && allowCorruptDataReplacement) AppState.state.recordsLoadFailed = false;
        return didPersist;
    };

    const persistRawLocalStorageValue = (key, value, errorMessage) => persistLocalStorageEntriesAtomically([
        { key, value: String(value) }
    ], errorMessage);

    const removeLocalStorageItemSafely = (key, errorMessage) => {
        let previousValue = null;
        try {
            previousValue = localStorage.getItem(key);
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.error('Diet localStorage remove failed:', error);
            if (previousValue !== null) {
                try { localStorage.setItem(key, previousValue); } catch (rollbackError) { console.error('Diet localStorage remove rollback failed:', rollbackError); }
            }
            showToast(errorMessage || '데이터 삭제를 저장소에 반영하지 못했습니다.');
            return false;
        }
    };


    const loadPersistedDietState = (storage, currentSettings) => {
        let records = [];
        let settings = sanitizeDietSettings(currentSettings);
        let recordsLoadFailed = false;

        // 기록과 설정을 독립적으로 읽습니다. 설정 JSON 하나가 손상됐다는 이유로
        // 정상적인 전체 체중 기록까지 빈 배열로 교체하면 다음 저장 시 실제 데이터가 유실될 수 있습니다.
        let storedRecords = null;
        try {
            storedRecords = storage.getItem(AppState.STORAGE_KEY);
        } catch (recordReadError) {
            recordsLoadFailed = true;
            console.error('Diet record storage read error. Continuing with empty records.', recordReadError);
        }
        if (storedRecords !== null) {
            try {
                const parsedRecords = JSON.parse(storedRecords);
                const normalizedRecords = normalizeImportedDietRecords(parsedRecords);
                if (!normalizedRecords.ok) {
                    // 화면에는 복구 가능한 유효 기록만 표시하되, 원본 저장값은 사용자가
                    // 명시적으로 복원/초기화하기 전까지 절대 덮어쓰지 않습니다.
                    records = sanitizeDietRecords(parsedRecords);
                    throw new Error(normalizedRecords.error);
                }
                records = normalizedRecords.records;
            } catch (recordError) {
                recordsLoadFailed = true;
                console.error('Diet record data load error. The original localStorage value was left untouched.', recordError);
            }
        }

        let storedSettings = null;
        try {
            storedSettings = storage.getItem(AppState.SETTINGS_KEY);
        } catch (settingsReadError) {
            console.error('Diet settings storage read error. Continuing with safe defaults.', settingsReadError);
        }
        if (storedSettings) {
            try {
                settings = sanitizeDietSettings(JSON.parse(storedSettings));
            } catch (settingsError) {
                // 설정만 기본값으로 되돌리고, 위에서 정상 로드한 기록은 그대로 보존합니다.
                console.error('Diet settings load error. Falling back to safe defaults without clearing records.', settingsError);
            }
        }

        return { records, settings, recordsLoadFailed };
    };

    // --- 2. 초기화 ---
    function init() {
        const ids = [
            'dateInput', 'weightInput', 'fatInput', 'userHeight', 'startWeight', 'goal1Weight', 'dailyIntake',
            'settingsPanel', 'badgeGrid', 'jsonFileInput', 'csvImportInput', 'resetConfirmInput', 'recordInputGroup',
            'chartStartDate', 'chartEndDate', 'showTrend',
            'currentWeightDisplay', 'totalLostDisplay', 'percentLostDisplay', 'progressPercent',
            'remainingWeightDisplay', 'remainingPercentDisplay', 'bmiDisplay', 'predictedDate',
            'predictionRange', 'dashboardRate7Days', 'dashboardRate30Days', 'streakDisplay', 'successRateDisplay', 'minMaxWeightDisplay',
            'dailyVolatilityDisplay', 'weeklyAvgDisplay', 'monthCompareDisplay', 'analysisText',
            'lbmDisplay', 'lbmiDisplay', 'dDayDisplay', 'estTdeeDisplay', 'estTdeeSubDisplay', 'weeklyEffDisplay', 'shortTrendDisplay', 
            'waterIndexDisplay', 'netChangeDisplay', 'netChangeSubDisplay', 'consistencyDisplay', 'deficitDisplay', 'ffmiDisplay',
            'maDisparityDisplay', 'weightClassDisplay', 'recoveryScoreDisplay', 
            'plateauHelperText', 'yoyoRiskDisplay', 'recent3DayAvgDisplay', 'weeklySpeedDisplay', 'idealWeeklyRateDisplay',
            'bodyCompBalanceDisplay', 'lossConsistencyDisplay', 'calEfficiencyDisplay', 'volatilityIndexDisplay', 'bodyCompTrendDisplay',
            'metabolicAgeDisplay', 'dietCostDisplay', 'weekendImpactDisplay', 'muscleLossCard', 'muscleLossDisplay',
            'paperTowelDisplay', 'bmiPrimeDisplay', 'surplusCalDisplay', 'metabolicAdaptDisplay',
            'cvDisplay', 'resistanceTableBody', 'weekdayProbTableBody', 'controlChart', 'violinChart', 'githubCalendarChart',
            'dailyWinRateTable', 'zoneDurationTable', 'streakDetailTable', 'bestWorstMonthTable', 'zoneReportTableBody', 'sprintTableBody', 'gradesTableBody',
            'top5TableBody', 'monthlyRateTableBody',
            'advancedAnalysisList', 'calendarContainer', 'periodCompareTable', 'detailedStatsTable',
            'progressBarFill', 'progressEmoji', 'progressText', 'labelStart', 'labelGoal',
            'bmiProgressBarFill', 'bmiProgressEmoji', 'bmiProgressText', 'bmiLabelLeft', 'bmiLabelRight', 'bmiStageScale',
            'rate7Days', 'rate30Days', 'weeklyCompareDisplay', 'heatmapGrid', 'chartBackdrop',
            'monthlyTableBody', 'weeklyTableBody', 'milestoneTableBody', 'historyList',
            'tab-monthly', 'tab-weekly', 'tab-milestone', 'tab-history', 'tab-zone', 'tab-sprint', 'tab-grades', 'tab-btn-top5', 'tab-btn-monthly-rate',
            'btn-1m', 'btn-3m', 'btn-6m', 'btn-1y', 'btn-all', 
            'tab-btn-monthly', 'tab-btn-weekly', 'tab-btn-milestone', 'tab-btn-history', 'tab-btn-zone', 'tab-btn-sprint', 'tab-btn-grades', 'tab-btn-top5', 'tab-btn-monthly-rate',
            'recordBtn',
            'radarChart', 'candleStickChart', 'macdChart', 'seasonalSpiralChart',
            // --- [NEW] v3.0.71 추가 ID ---
            'trendDeviationDisplay', 'lbmRetentionDisplay', 'sodiumWarningDisplay', 'cvStatusDisplay',
            'goalTunnelChart', 'drawdownChart', 'lbmFatAreaChart', 'speedometerChart',
            'wallTableBody', 'monthlyFatLossTableBody',
            // [추가] 이벤트 리스너용 ID들
            'btn-theme-toggle', 'btn-settings-toggle', 'btn-save-settings', 'btn-import-json', 'btn-export-json', 'btn-export-csv', 'btn-import-csv', 'btn-reset-data', 'badge-toggle-header',
            // [추가] 의학 근거 기반 A4 20페이지 서술형 분석 리포트
            'medicalNarrativeCard', 'medicalNarrativeSummary', 'medicalNarrativeReport',
            'btn-generate-medical-narrative', 'btn-copy-medical-narrative', 'btn-download-medical-narrative', 'btn-print-medical-narrative'
        ];
        ids.forEach(id => AppState.getEl(id));
        
        // --- [CSP 수정] 이벤트 리스너 연결 ---
        const bindClick = (id, handler) => {
            const el = document.getElementById(id);
            if(el) el.addEventListener('click', handler);
        };
        const bindChange = (id, handler) => {
            const el = document.getElementById(id);
            if(el) el.addEventListener('change', handler);
        };

        bindClick('btn-theme-toggle', toggleDarkMode);
        bindClick('btn-settings-toggle', toggleSettings);
        bindClick('btn-save-settings', saveSettings);
        bindClick('btn-import-json', importJSON);
        bindClick('btn-export-json', exportJSON);
        bindClick('btn-export-csv', exportCSV);
        bindClick('btn-import-csv', importCSV);
        bindClick('btn-reset-data', safeResetData);
        bindClick('recordBtn', addRecord);
        bindClick('badge-toggle-header', toggleBadges);
        bindClick('chartBackdrop', closeAllExpands);
        bindClick('btn-generate-medical-narrative', () => renderMedicalNarrativeReport(AppState.state.statsCache || analyzeRecords(AppState.records), true));
        bindClick('btn-copy-medical-narrative', copyMedicalNarrativeReport);
        bindClick('btn-download-medical-narrative', downloadMedicalNarrativeReport);
        bindClick('btn-print-medical-narrative', printMedicalNarrativeReport);
        window.addEventListener('afterprint', () => document.body.classList.remove('print-narrative-only'));

        bindChange('showTrend', updateMainChart);
        bindChange('chartStartDate', applyCustomDateRange);
        bindChange('chartEndDate', applyCustomDateRange);

        // 필터 버튼들
        bindClick('btn-1m', () => setChartFilter('1M'));
        bindClick('btn-3m', () => setChartFilter('3M'));
        bindClick('btn-6m', () => setChartFilter('6M'));
        bindClick('btn-1y', () => setChartFilter('1Y'));
        bindClick('btn-all', () => setChartFilter('ALL'));

        // 탭 버튼들
        bindClick('tab-btn-history', () => switchTab('tab-history'));
        bindClick('tab-btn-monthly', () => switchTab('tab-monthly'));
        bindClick('tab-btn-weekly', () => switchTab('tab-weekly'));
        bindClick('tab-btn-milestone', () => switchTab('tab-milestone'));
        bindClick('tab-btn-zone', () => switchTab('tab-zone'));
        bindClick('tab-btn-sprint', () => switchTab('tab-sprint'));
        bindClick('tab-btn-grades', () => switchTab('tab-grades'));
        bindClick('tab-btn-top5', () => switchTab('tab-top5'));
        bindClick('tab-btn-monthly-rate', () => switchTab('tab-monthly-rate'));

        // 확대 버튼들 (클래스 기반)
        document.querySelectorAll('.expand-chart-btn').forEach(btn => {
            btn.addEventListener('click', function() { toggleChartExpand(this); });
        });

        // -------------------------------------
        // [수정됨] 캘린더 뷰 이벤트 위임 추가 (버튼 및 셀렉트 박스)
        const calContainer = AppState.getEl('calendarContainer');
        if (calContainer) {
            calContainer.addEventListener('click', (e) => {
                if (e.target.classList.contains('cal-btn-prev')) {
                    changeCalendarMonth(-1);
                } else if (e.target.classList.contains('cal-btn-next')) {
                    changeCalendarMonth(1);
                }
            });
            calContainer.addEventListener('change', (e) => {
                if (e.target.id === 'calYearSelect' || e.target.id === 'calMonthSelect') {
                    jumpToCalendarDate();
                }
            });
        }
        // -------------------------------------

        const dateInput = AppState.getEl('dateInput');
        if (dateInput) dateInput.value = DateUtil.format(new Date());
        
        const persistedDietState = loadPersistedDietState(localStorage, AppState.settings);
        AppState.records = persistedDietState.records;
        AppState.settings = persistedDietState.settings;
        AppState.state.recordsLoadFailed = persistedDietState.recordsLoadFailed;
        restoreInlineEditDraftFromSession();

        try {
            const persistedFilterMode = sanitizeChartFilterMode(localStorage.getItem(AppState.FILTER_KEY));
            if (persistedFilterMode === 'CUSTOM') {
                const persistedCustomStart = localStorage.getItem(AppState.CUSTOM_FILTER_START_KEY);
                const persistedCustomEnd = localStorage.getItem(AppState.CUSTOM_FILTER_END_KEY);
                const hasValidCustomRange = DateUtil.isValidDateString(persistedCustomStart)
                    && DateUtil.isValidDateString(persistedCustomEnd)
                    && DateUtil.parse(persistedCustomStart) <= DateUtil.parse(persistedCustomEnd);

                if (hasValidCustomRange) {
                    AppState.chartFilterMode = 'CUSTOM';
                    AppState.customStart = persistedCustomStart;
                    AppState.customEnd = persistedCustomEnd;
                    AppState.getEl('chartStartDate').value = persistedCustomStart;
                    AppState.getEl('chartEndDate').value = persistedCustomEnd;
                } else {
                    AppState.chartFilterMode = 'ALL';
                    AppState.customStart = null;
                    AppState.customEnd = null;
                }
            } else {
                AppState.chartFilterMode = persistedFilterMode;
            }
        } catch (filterReadError) {
            console.error('Diet chart filter storage read error. Falling back to ALL.', filterReadError);
            AppState.chartFilterMode = 'ALL';
            AppState.customStart = null;
            AppState.customEnd = null;
        }
        
        // [기능 추가] 부모 창(MothNote)의 테마 설정 확인 (URL 파라미터)
        const urlParams = new URLSearchParams(window.location.search);
        const theme = urlParams.get('theme') === 'dark' ? 'dark' : 'light';
        let persistedDarkMode = false;
        try {
            persistedDarkMode = localStorage.getItem('diet_pro_dark_mode') === 'true';
        } catch (themeReadError) {
            console.warn('Diet theme storage read failed. Continuing with the URL/default theme.', themeReadError);
        }
        if (theme === 'dark') {
            document.body.classList.add('dark-mode');
        } else if (persistedDarkMode) {
            document.body.classList.add('dark-mode');
        }

        syncDietSettingsInputs(AppState.settings);

        if(AppState.records.length > 0) {
            AppState.state.calendarViewDate = DateUtil.parse(AppState.records[AppState.records.length-1].date);
        }

        // 이벤트 위임
        const hmGrid = AppState.getEl('heatmapGrid');
        if (hmGrid) {
            hmGrid.addEventListener('click', (e) => {
                const cell = getClosestElement(e.target, '.heatmap-cell');
                if(cell && cell.title) showToast(cell.title);
            });
        }
        
        const badgeGrid = AppState.getEl('badgeGrid');
        if (badgeGrid) {
            badgeGrid.addEventListener('click', (e) => {
                const item = getClosestElement(e.target, '.badge-item');
            });
        }

        const handleEnter = (e) => { if(e.key === 'Enter') addRecord(); };
        const wInput = AppState.getEl('weightInput');
        const fInput = AppState.getEl('fatInput');
        if (wInput) wInput.addEventListener('keyup', handleEnter);
        if (fInput) fInput.addEventListener('keyup', handleEnter);

        const histList = AppState.getEl('historyList');
        if (histList) {
            histList.addEventListener('input', (e) => {
                const input = getClosestElement(e.target, 'input[data-inline-field][data-date]');
                const draft = AppState.state.inlineEditDraft;
                if (!input || !draft || input.dataset.date !== draft.date) return;

                if (input.dataset.inlineField === 'weight') draft.weight = input.value;
                if (input.dataset.inlineField === 'fat') draft.fat = input.value;
                persistInlineEditDraftToSession();
            });

            histList.addEventListener('click', (e) => {
                const btn = getClosestElement(e.target, 'button');
                if (!btn) return;
                const action = btn.dataset.action;
                const date = btn.dataset.date;
                const inlineActions = {
                    edit: 'enableInlineEdit',
                    'save-inline': 'saveInlineEdit',
                    'cancel-inline': 'cancelInlineEdit'
                };
                
                if (action === 'delete') {
                    if (!DateUtil.isValidDateString(date)) return showToast('잘못된 기록 날짜입니다.');
                    deleteRecord(date);
                    return;
                }

                const methodName = inlineActions[action];
                if (!methodName) return;

                const dietAppApi = window.App;
                if (!dietAppApi || typeof dietAppApi[methodName] !== 'function') {
                    console.error('Diet inline edit API is unavailable:', methodName);
                    showToast('기록 편집 기능을 초기화하지 못했습니다. 페이지를 새로고침해주세요.');
                    return;
                }

                if ((action === 'edit' || action === 'save-inline') && !DateUtil.isValidDateString(date)) {
                    return showToast('잘못된 기록 날짜입니다.');
                }

                dietAppApi[methodName](date);
            });
        }
        
        // [기능 추가] 부모 창(MothNote)로부터 테마 변경 메시지 수신
        window.addEventListener('message', (event) => {
            if (event.origin !== window.location.origin || event.source !== window.parent) {
                console.warn('Blocked a message from an untrusted source:', event.origin);
                return;
            }
            if (event.data && event.data.type === 'setTheme') {
                if (event.data.theme === 'dark') {
                    document.body.classList.add('dark-mode');
                    persistRawLocalStorageValue('diet_pro_dark_mode', 'true', '테마 설정을 저장하지 못했습니다.');
                } else {
                    document.body.classList.remove('dark-mode');
                    persistRawLocalStorageValue('diet_pro_dark_mode', 'false', '테마 설정을 저장하지 못했습니다.');
                }
                updateUI(); // 테마 변경 후 UI(차트 등) 업데이트
            }
        });

        updateFilterButtons();
        updateUI();
        if (AppState.state.recordsLoadFailed) {
            showToast(DIET_RECORD_RECOVERY_REQUIRED_MESSAGE);
        }
    }
	
    // --- 3. 기본 기능 ---
    const debouncedSaveRecords = debounce(() => {
        persistDietRecordsImmediate();
    }, 500);

    const debouncedSaveSettings = debounce(() => {
        persistDietSettingsImmediate();
    }, 500);

    const flushPendingStorageWrites = () => {
        debouncedSaveRecords.flush();
        debouncedSaveSettings.flush();
    };

    // 새 탭을 닫거나 다른 페이지로 이동하는 순간이 500ms 지연 저장보다 빠르더라도
    // 마지막 기록/설정을 잃지 않도록 브라우저 생명주기 이벤트에서 즉시 저장합니다.
    window.addEventListener('pagehide', flushPendingStorageWrites);
    window.addEventListener('beforeunload', flushPendingStorageWrites);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushPendingStorageWrites();
    });

    function showToast(message) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerText = message;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    function toggleSettings() {
        const panel = AppState.getEl('settingsPanel');
        panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    }

    function toggleBadges() {
        const grid = AppState.getEl('badgeGrid');
        grid.style.display = grid.style.display === 'grid' ? 'none' : 'grid';
    }

    function toggleDarkMode() {
        document.body.classList.toggle('dark-mode');
        persistRawLocalStorageValue('diet_pro_dark_mode', document.body.classList.contains('dark-mode') ? 'true' : 'false', '테마 설정을 저장하지 못했습니다.');
        updateUI(); 
    }

    function saveSettings() {
        const height = parseFloat(AppState.getEl('userHeight').value);
        const startWeight = parseFloat(AppState.getEl('startWeight').value);
        const goal1 = parseFloat(AppState.getEl('goal1Weight').value);
        const intake = parseFloat(AppState.getEl('dailyIntake').value);

        if (isNaN(height) || height <= 0 || height > 300) return showToast('유효한 키(cm)를 입력해주세요.');
        if (isNaN(startWeight) || startWeight <= 0 || startWeight > 500) return showToast('유효한 시작 체중을 입력해주세요.');
        if (isNaN(goal1) || goal1 <= 0 || goal1 > 500) return showToast('유효한 목표 체중을 입력해주세요.');
        if (!Number.isFinite(intake) || intake < 1 || intake > 10000) return showToast('유효한 하루 섭취 칼로리를 입력해주세요 (1~10000kcal).');

        const nextSettings = sanitizeDietSettings({ height, startWeight, goal1, intake: Math.round(intake) });
        if (!persistDietSettingsImmediate(nextSettings)) return;

        AppState.settings = nextSettings;
        AppState.state.isDirty = true;
        toggleSettings();
        updateUI();
        showToast('설정이 저장되었습니다.');
    }

	function addRecord() {
        // [수정 핵심] 버튼 엘리먼트를 가장 먼저 가져옵니다.
        const btn = AppState.getEl('recordBtn');

        // [수정 핵심] 중복 실행 방지 (Debounce)
        // 버튼이 비활성화(처리 중) 상태라면, 유효성 검사도 하지 않고 즉시 함수를 종료합니다.
        // 이 코드가 맨 위에 있어야 두 번째 호출 시 "체중을 입력해주세요" 메시지가 뜨지 않습니다.
        if (btn.disabled) return;

        const dateInput = AppState.getEl('dateInput');
        const weightInput = AppState.getEl('weightInput');
        const fatInput = AppState.getEl('fatInput');

        // 값 가져오기
        const date = dateInput.value;
        const weightStr = weightInput.value; 
        const fatStr = fatInput.value;

        if (!date || !DateUtil.isValidDateString(date)) return showToast('유효한 날짜를 입력해주세요.');
        if (DateUtil.isFuture(date)) return showToast('미래 날짜의 기록은 추가할 수 없습니다.');
        
        // 값이 비어있는지 확인
        if (!weightStr || weightStr.trim() === '') {
            return showToast('체중을 입력해주세요.'); 
        }

        const weight = parseFloat(weightStr);
        const fat = parseFloat(fatStr);

        // 유효성 검사
        if (isNaN(weight) || weight < CONFIG.LIMITS.MIN_WEIGHT || weight > CONFIG.LIMITS.MAX_WEIGHT) {
            return showToast(`유효한 체중을 입력해주세요 (${CONFIG.LIMITS.MIN_WEIGHT}~${CONFIG.LIMITS.MAX_WEIGHT}kg).`);
        }
        if (fatStr && (isNaN(fat) || fat < CONFIG.LIMITS.MIN_FAT || fat > CONFIG.LIMITS.MAX_FAT)) {
            return showToast(`유효한 체지방률을 입력해주세요 (${CONFIG.LIMITS.MIN_FAT}~${CONFIG.LIMITS.MAX_FAT}%).`);
        }

        // [수정 핵심] 유효성 검사를 통과했다면 즉시 버튼을 잠급니다.
        btn.disabled = true;
        const previousRecords = cloneDietRecords(AppState.records);

        try {
            const record = { date, weight: MathUtil.round(weight) };
            if (!isNaN(fat) && fatStr !== '') record.fat = MathUtil.round(fat);

            const existingIndex = AppState.records.findIndex(r => r.date === date);

            if (AppState.state.editingDate) {
                // 수정 모드일 때
                if (AppState.state.editingDate !== date) {
                    // 날짜를 변경해서 수정하는 경우
                    if (existingIndex >= 0) {
                        if (!confirm(`${date}에 이미 기록이 있습니다. 덮어쓰시겠습니까?`)) {
                            // 사용자가 취소하면 버튼 잠금 해제 후 종료
                            btn.disabled = false; return;
                        }
                        AppState.records = AppState.records.filter(r => r.date !== AppState.state.editingDate && r.date !== date);
                        AppState.records.push(record);
                    } else {
                        AppState.records = AppState.records.filter(r => r.date !== AppState.state.editingDate);
                        AppState.records.push(record);
                    }
                } else {
                    // 날짜는 그대로두고 값만 수정하는 경우
                    if (existingIndex >= 0) {
                        AppState.records[existingIndex] = record;
                    } else {
                        // 편집을 시작한 뒤 삭제/가져오기 등으로 원본 기록이 사라졌다면
                        // 배열의 "-1" 속성에 쓰지 말고 제출한 기록을 정상 항목으로 복구합니다.
                        AppState.records.push(record);
                    }
                }
            } else {
                // 신규 기록일 때
                if (existingIndex >= 0) {
                    if(!confirm(`${date}에 이미 기록이 있습니다. 덮어쓰시겠습니까?`)) {
                        // 사용자가 취소하면 버튼 잠금 해제 후 종료
                        btn.disabled = false; return;
                    }
                    AppState.records[existingIndex] = record;
                } else {
                    AppState.records.push(record);
                }
            }

            // 데이터 정렬 및 저장
            const nextRecords = sanitizeDietRecords(AppState.records);
            if (!persistDietRecordsImmediate(nextRecords)) {
                AppState.records = previousRecords;
                return;
            }
            AppState.records = nextRecords;
            AppState.state.isDirty = true;
            
            // 입력창 초기화 및 UI 업데이트
            resetForm(date); 
            updateUI();
            showToast('기록이 저장되었습니다.');

        } catch (e) {
            console.error(e);
            showToast('저장 중 오류가 발생했습니다.');
        } finally {
            // [수정 핵심] 처리가 끝나면(성공이든 실패든) 잠시 후 버튼 잠금을 해제합니다.
            // 500ms 딜레이는 엔터키 연타로 인한 중복 실행을 확실하게 막아줍니다.
            setTimeout(() => { btn.disabled = false; }, 500);
        }
    }
	
    function resetForm(lastDateStr = null) {
        if (lastDateStr) {
            AppState.getEl('dateInput').value = DateUtil.addDays(lastDateStr, 1);
        } else {
            AppState.getEl('dateInput').value = DateUtil.format(new Date());
        }
        AppState.getEl('weightInput').value = '';
        AppState.getEl('fatInput').value = '';
        AppState.state.editingDate = null;
        
        const rBtn = AppState.getEl('recordBtn');
        rBtn.innerText = '기록하기 📝';
        rBtn.classList.remove('editing-mode');
        AppState.getEl('weightInput').focus();
    }

    function deleteRecord(date) {
        if(confirm('이 날짜의 기록을 삭제하시겠습니까?')) {
            const nextRecords = sanitizeDietRecords(AppState.records.filter(r => r.date !== date));
            if (!persistDietRecordsImmediate(nextRecords)) return;
            AppState.records = nextRecords;
            AppState.state.isDirty = true;
            updateUI();
            showToast('삭제되었습니다.');
        }
    }

    function editRecord(date) {
        const record = AppState.records.find(r => r.date === date);
        if (record) {
            AppState.getEl('dateInput').value = record.date;
            AppState.getEl('weightInput').value = record.weight;
            if (record.fat) AppState.getEl('fatInput').value = record.fat;
            else AppState.getEl('fatInput').value = '';
            
            AppState.state.editingDate = date; 
            const rBtn = AppState.getEl('recordBtn');
            rBtn.innerText = '수정 완료 ✔️';
            rBtn.classList.add('editing-mode');

            window.scrollTo({ top: 0, behavior: 'smooth' });
            showToast(`${date} 기록을 수정합니다.`);
            
            const inputGroup = AppState.getEl('recordInputGroup');
            inputGroup.classList.add('highlight');
            setTimeout(() => inputGroup.classList.remove('highlight'), 1000);
        }
    }

    function safeResetData() {
        const input = AppState.getEl('resetConfirmInput');
        if (input.value === "초기화") {
            if (!removeLocalStorageItemSafely(AppState.STORAGE_KEY, '초기화를 저장소에 반영하지 못했습니다. 기존 데이터를 유지합니다.')) return;
            AppState.state.recordsLoadFailed = false;
            AppState.records = [];
            AppState.state.isDirty = true;
            input.value = '';
            updateUI();
            showToast('초기화되었습니다.');
        } else {
            showToast('"초기화"라고 정확히 입력해주세요.');
        }
    }

    function importJSON() {
        const file = AppState.getEl('jsonFileInput').files[0];
        if (!file) return showToast('JSON 파일을 선택해주세요.');
        if (!beginDietImport()) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const content = getFileReaderText(e);
            try {
                if (!content) throw new Error('파일 내용이 비어 있거나 텍스트 형식이 아닙니다.');
                const data = JSON.parse(content);
                if (!isPlainObject(data) || !Object.prototype.hasOwnProperty.call(data, 'records')) {
                    throw new Error('올바르지 않은 JSON 형식');
                }

                const importResult = normalizeImportedDietRecords(data.records);
                if (!importResult.ok) throw new Error(importResult.error);

                const hasSettings = Object.prototype.hasOwnProperty.call(data, 'settings');
                const settingsImportResult = hasSettings
                    ? normalizeImportedDietSettings(data.settings, AppState.settings)
                    : { ok: true, settings: AppState.settings, error: '' };
                if (!settingsImportResult.ok) throw new Error(settingsImportResult.error);

                if (data.records.length === 0 && AppState.records.length > 0) {
                    const shouldReplaceWithEmpty = confirm(`가져올 백업에 체중 기록이 없습니다. 계속하면 현재 기록 ${AppState.records.length}건이 모두 삭제됩니다. 빈 백업으로 복원하시겠습니까?`);
                    if (!shouldReplaceWithEmpty) {
                        showToast('빈 백업 복원을 취소했습니다. 기존 데이터를 유지합니다.');
                        return;
                    }
                }

                const nextRecords = importResult.records;
                const nextSettings = settingsImportResult.settings;
                if (!persistDietStateSnapshot(nextRecords, nextSettings, { allowCorruptDataReplacement: true })) return;

                AppState.records = nextRecords;
                AppState.settings = nextSettings;
                syncDietSettingsInputs(AppState.settings);
                AppState.state.isDirty = true;
                
                updateUI();
                showToast(`데이터(JSON) 복원 완료: ${AppState.records.length}건`);
            } catch(err) {
                showToast('JSON 파일 오류: ' + err.message);
            } finally {
                finishDietImport();
            }
        };
        reader.onerror = function() {
            console.error('JSON file read failed:', reader.error);
            showToast('JSON 파일을 읽을 수 없습니다. 파일 상태를 확인해주세요.');
            finishDietImport();
        };
        reader.onabort = function() {
            showToast('JSON 파일 읽기가 취소되었습니다.');
            finishDietImport();
        };
        try {
            reader.readAsText(file);
        } catch (readError) {
            console.error('JSON file read could not be started:', readError);
            showToast('JSON 파일을 읽을 수 없습니다. 파일 상태를 확인해주세요.');
            finishDietImport();
        }
    }

    function importCSV() {
        const file = AppState.getEl('csvImportInput').files[0];
        if (!file) return showToast('CSV 파일을 선택해주세요.');
        if (!beginDietImport()) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const content = getFileReaderText(e);
                if (!content) return showToast('CSV 파일 내용이 비어 있거나 텍스트 형식이 아닙니다.');
                const lines = content.split(/\r?\n/);
                let count = 0;
                let rejectedCount = 0;
                const nextRecords = cloneDietRecords(AppState.records);
                
                for(let i=0; i<lines.length; i++) {
                    const line = lines[i].trim();
                    if(!line || line.toLowerCase().startsWith('date')) continue; 
                    
                    const matches = parseCsvLineSafely(line);
                    
                    if(matches.length >= 2) {
                        const d = matches[0].trim().replace(/['"]/g, ''); 
                        const weightText = String(matches[1] ?? '').trim();
                        const fatText = String(matches[2] ?? '').trim();
                        const w = Number(weightText);
                        const hasFat = fatText !== '';
                        const fat = hasFat ? Number(fatText) : undefined;

                        // parseFloat('77kg')나 잘못된 체지방 문자열을 부분적으로 받아들이면,
                        // 같은 날짜의 정상 기록을 덮어쓰면서 기존 체지방률만 조용히 삭제될 수 있습니다.
                        if (!weightText || !Number.isFinite(w) || (hasFat && !Number.isFinite(fat))) {
                            rejectedCount++;
                            continue;
                        }

                        const rec = sanitizeDietRecord({ date: d, weight: w, fat });
                        if(rec) {
                            const idx = nextRecords.findIndex(r => r.date === rec.date);
                            if(idx >= 0) nextRecords[idx] = rec;
                            else nextRecords.push(rec);
                            count++;
                        } else {
                            rejectedCount++;
                        }
                    } else {
                        rejectedCount++;
                    }
                }
                const sanitizedRecords = sanitizeDietRecords(nextRecords);
                if (!persistDietRecordsImmediate(sanitizedRecords)) return;
                AppState.records = sanitizedRecords;
                AppState.state.isDirty = true;
                
                updateUI();
                const rejectedMessage = rejectedCount > 0 ? ` (잘못된 행 ${rejectedCount}건은 기존 데이터를 보호하기 위해 건너뜀)` : '';
                showToast(`${count}건의 데이터(CSV)를 불러왔습니다.${rejectedMessage}`);
            } catch (importError) {
                console.error('CSV import failed:', importError);
                showToast('CSV 파일 오류: ' + importError.message);
            } finally {
                finishDietImport();
            }
        };
        reader.onerror = function() {
            console.error('CSV file read failed:', reader.error);
            showToast('CSV 파일을 읽을 수 없습니다. 파일 상태를 확인해주세요.');
            finishDietImport();
        };
        reader.onabort = function() {
            showToast('CSV 파일 읽기가 취소되었습니다.');
            finishDietImport();
        };
        try {
            reader.readAsText(file);
        } catch (readError) {
            console.error('CSV file read could not be started:', readError);
            showToast('CSV 파일을 읽을 수 없습니다. 파일 상태를 확인해주세요.');
            finishDietImport();
        }
    }

	function exportCSV() {
        if (AppState.records.length === 0) return showToast('내보낼 데이터가 없습니다.');
        let csvContent = "\uFEFFDate,Weight,BodyFat\n";
        AppState.records.forEach(row => {
            csvContent += `${row.date},${row.weight},${row.fat || ''}\n`;
        });

        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        
        const fileName = `${yy}${mm}${dd}_Diet_Challenge_Backup.csv`;
        downloadFile(csvContent, fileName, "text/csv;charset=utf-8");
    }

	function exportJSON() {
        const data = {
            settings: AppState.settings,
            records: AppState.records,
            exportDate: new Date().toISOString()
        };

        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        
        const fileName = `${yy}${mm}${dd}_Diet_Challenge_Backup.json`;
        downloadFile(JSON.stringify(data, null, 2), fileName, "application/json");
    }
	
    function downloadFile(content, fileName, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // --- 4. 메인 렌더링 함수 ---
    function updateUI() {
        // 테마/필터/설정 변경도 전체 표를 다시 그립니다. 렌더링 전에 현재 입력값을
        // 메모리 초안으로 옮겨, 저장 버튼을 누르기 전의 인라인 편집이 사라지지 않게 합니다.
        captureInlineEditDraftFromDom();

        // 이미 데이터를 렌더링한 화면에서 마지막 기록을 삭제하거나,
        // 전체 초기화·빈 백업 복원을 하면 여러 차트/통계 함수의 조기 return 때문에
        // 삭제된 체중·체지방 값이 DOM과 Chart 인스턴스에 남을 수 있습니다.
        // 초기 빈 화면에서는 루프를 만들지 않고, 빈 상태로 '전환'될 때만
        // 문서를 재구성해 모든 파생 화면을 한 번에 정리합니다.
        if (AppState.records.length === 0 && AppState.state.hasRenderedNonEmptyRecords) {
            AppState.state.hasRenderedNonEmptyRecords = false;
            window.location.reload();
            return;
        }
        if (AppState.records.length > 0) {
            AppState.state.hasRenderedNonEmptyRecords = true;
        }

        if(AppState.state.isDirty) {
            AppState.state.statsCache = analyzeRecords(AppState.records);
            AppState.state.isDirty = false;
        }
        const s = AppState.state.statsCache;
        
        renderStats(s);
        renderNewStats(s); 
        renderAnalysisText(s);
        renderAdvancedText(s); 
        renderMedicalNarrativeReport(s);
        renderPlateauHelper(s); 
        renderPeriodComparison(); 
        renderDetailedStats(s); 
        renderExtendedStats(); 
        renderNewTables(); 
        
        renderResistanceTable();
        renderWeekdayProbTable();

        const colors = DomUtil.getChartColors();
        updateMainChart(colors);
        updateDayOfWeekChart(colors);
        updateHistogram(colors);
        updateCumulativeChart(colors);
        updateMonthlyChangeChart(colors);
        updateBodyFatChart(colors);
        updateScatterChart(colors); 
        updateWeekendChart(colors); 
        updateBodyCompStackedChart(colors); 
        updateMonthlyBoxPlotChart(colors); 
        updateRocChart(colors); 

        updateGhostRunnerChart(colors);
        updateGaugeCharts(colors);
        updateWeeklyBodyCompChart(colors); 
        updateWeightSpeedScatterChart(colors); 
        updateWaterfallChart(colors);
        updateSeasonalityChart(colors);
        updateBellCurveChart(colors);
        
        updateRadarChart(colors);
        updateCandleStickChart(colors);
        updateMacdChart(colors);
        updateSeasonalSpiralChart(colors);

        updateControlChart(colors);
        updateViolinChart(colors);
        updateGithubStyleCalendar();
        
        // --- [NEW] v3.0.71 추가 차트 업데이트 호출 ---
        updateGoalTunnelChart(colors);
        updateDrawdownChart(colors);
        updateLbmFatAreaChart(colors);
        updateSpeedometerChart(colors);

        renderHeatmap();
        renderCalendarView(); 
        renderAllTables();
        renderBadges(s);
    }

    // --- 5. 분석 계산 로직 ---
    function analyzeRecords(records) {
        if (!records || records.length === 0) return {};
        
        const weights = records.map(r => r.weight);
        const current = weights[weights.length - 1];
        const min = Math.min(...weights);
        const max = Math.max(...weights);
        const lastRec = records[records.length - 1];
        
        let maxStreak = 0, curStreak = 0;
        let successCount = 0;
        let maxDrop = 0, maxGain = 0;
        let diffs = [];

        if (records.length > 1) {
            for (let i = 1; i < records.length; i++) {
                const diff = MathUtil.diff(records[i].weight, records[i-1].weight);
                diffs.push(diff);

                const dayDiff = DateUtil.daysBetween(DateUtil.parse(records[i-1].date), DateUtil.parse(records[i].date));
                if (dayDiff === 1 && diff <= 0) curStreak++;
                else curStreak = 0;
                if (curStreak > maxStreak) maxStreak = curStreak;

                if (diff < 0) successCount++;

                if (dayDiff === 1) {
                    if (diff < 0 && Math.abs(diff) > maxDrop) maxDrop = Math.abs(diff);
                    if (diff > 0 && diff > maxGain) maxGain = diff;
                }
            }
        }

        const maxRec = records.find(r => r.weight === max) || {};
        const minRec = records.find(r => r.weight === min) || {};
        const stdDev = MathUtil.stdDev(weights);
        
        const mean = MathUtil.mean(weights);
        const cv = mean !== 0 ? (stdDev / mean) * 100 : 0;

        let fatChange = 0, lbmChange = 0;
        const firstFatRec = records.find(r => r.fat);
        const lastFatRec = [...records].reverse().find(r => r.fat);
        if(firstFatRec && lastFatRec) {
            const startFatKg = firstFatRec.weight * (firstFatRec.fat / 100);
            const endFatKg = lastFatRec.weight * (lastFatRec.fat / 100);
            fatChange = MathUtil.diff(endFatKg, startFatKg);
            
            const startLbmKg = firstFatRec.weight * (1 - firstFatRec.fat / 100);
            const endLbmKg = lastFatRec.weight * (1 - lastFatRec.fat / 100);
            lbmChange = MathUtil.diff(endLbmKg, startLbmKg);
        }

        let maxPlateau = 0, curPlateau = 0;
        for(let i=1; i<records.length; i++) {
            if(isNextCalendarDay(records[i-1], records[i])
                && Math.abs(MathUtil.diff(records[i].weight, records[i-1].weight)) < 0.2) curPlateau++;
            else curPlateau = 0;
            if(curPlateau > maxPlateau) maxPlateau = curPlateau;
        }

        const totalLost = MathUtil.diff(AppState.settings.startWeight, current);
        const hMeter = AppState.settings.height / 100;
		const bmi = Math.round((current / (hMeter * hMeter)) * 100) / 100;

        const getRateVal = (days) => {
             const now = new Date(); now.setHours(0,0,0,0);
             const startTimestamp = now.getTime() - (days * 24 * 60 * 60 * 1000);
             const rel = records.filter(r => DateUtil.parse(r.date).getTime() >= startTimestamp);
             if(rel.length < 2) return "-";
             const diff = MathUtil.diff(rel[rel.length-1].weight, rel[0].weight);
             const d = DateUtil.daysBetween(DateUtil.parse(rel[0].date), DateUtil.parse(rel[rel.length-1].date));
             if(d===0) return "-";
             const g = Math.round((diff / d) * 1000);
             return `${g > 0 ? '+' : ''}${g}g / 일`;
        };
        const rate7 = getRateVal(7);
        const rate30 = getRateVal(30);

        const now = new Date(); now.setHours(0,0,0,0);
        const t7 = now.getTime() - (7 * 24 * 60 * 60 * 1000);
        const t14 = now.getTime() - (14 * 24 * 60 * 60 * 1000);
        const thisW = records.filter(r => DateUtil.parse(r.date).getTime() >= t7);
        const lastW = records.filter(r => { const t = DateUtil.parse(r.date).getTime(); return t >= t14 && t < t7; });
        let weeklyComp = "데이터 부족";
        if(thisW.length > 0 && lastW.length > 0) {
            const avgT = thisW.reduce((a,b)=>a+b.weight,0)/thisW.length;
            const avgL = lastW.reduce((a,b)=>a+b.weight,0)/lastW.length;
            const diff = MathUtil.diff(avgT, avgL);
            const icon = diff < 0 ? '🔻' : (diff > 0 ? '🔺' : '➖');
            weeklyComp = `${icon} ${Math.abs(diff)}kg`;
        }

        const thisMonthKey = DateUtil.format(now).slice(0, 7);
        const lastMonthDate = DateUtil.addMonthsClamped(now, -1);
        const lastMonthKey = DateUtil.format(lastMonthDate).slice(0, 7);
        const thisMonthRecs = records.filter(r => r.date.startsWith(thisMonthKey));
        const lastMonthRecs = records.filter(r => r.date.startsWith(lastMonthKey));
        let monthlyComp = '-';
        if(thisMonthRecs.length > 0 && lastMonthRecs.length > 0) {
            const avgThis = thisMonthRecs.reduce((a,b)=>a+b.weight,0)/thisMonthRecs.length;
            const avgLast = lastMonthRecs.reduce((a,b)=>a+b.weight,0)/lastMonthRecs.length;
            const diff = MathUtil.diff(avgThis, avgLast);
            monthlyComp = `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)}kg`;
        }
        
        let weeklyAvgLoss = '-';
        if(records.length >= 2) {
             const weeks = {};
             [...records].forEach(r => {
                const d = DateUtil.parse(r.date);
                const day = d.getDay();
                const monday = new Date(d.setDate(d.getDate() - day + (day == 0 ? -6 : 1)));
                monday.setHours(0,0,0,0);
                const key = monday.getTime();
                if(!weeks[key]) weeks[key] = [];
                weeks[key].push(r.weight);
             });
             const weekKeys = Object.keys(weeks).sort();
             if(weekKeys.length >= 2) {
                 let totalL = 0, count = 0;
                 for(let i=1; i<weekKeys.length; i++) {
                     const prevAvg = weeks[weekKeys[i-1]].reduce((a,b)=>a+b,0)/weeks[weekKeys[i-1]].length;
                     const currAvg = weeks[weekKeys[i]].reduce((a,b)=>a+b,0)/weeks[weekKeys[i]].length;
                     totalL += (prevAvg - currAvg);
                     count++;
                 }
                 if(count > 0) weeklyAvgLoss = (totalL / count).toFixed(2);
             }
        }

        return {
            current, min, max, maxStreak, lastRec, diffs,
            successRate: records.length > 1 ? Math.round((successCount / (records.length - 1)) * 100) : 0,
            maxDrop: MathUtil.round(maxDrop), 
            maxGain: MathUtil.round(maxGain),
            maxDate: maxRec.date, minDate: minRec.date,
            stdDev: stdDev,
            cv: cv,
            fatChange, lbmChange,
            maxPlateau,
            totalLost, bmi, rate7, rate30, weeklyComp, monthlyComp, weeklyAvgLoss
        };
    }

    // --- 6. 통계 렌더링 ---
    function renderStats(s) {
        const hasRecords = AppState.records.length > 0;
        const currentW = s.current !== undefined ? s.current : AppState.settings.startWeight;
        const totalLost = s.totalLost !== undefined ? s.totalLost : 0;
        
        AppState.getEl('currentWeightDisplay').innerText = currentW.toFixed(1) + 'kg';
        const totalLostEl = AppState.getEl('totalLostDisplay');
        totalLostEl.innerText = `${totalLost}kg`;
        DomUtil.setTextColor(totalLostEl, totalLost > 0 ? 'primary' : (totalLost < 0 ? 'danger' : 'default'));

        let pct = 0;
        const totalGap = MathUtil.diff(AppState.settings.startWeight, AppState.settings.goal1);
        const currentGap = MathUtil.diff(AppState.settings.startWeight, currentW);
        if(Math.abs(totalGap) > 0.01) {
             pct = (currentGap / totalGap) * 100;
        }
        
        const displayPct = MathUtil.clamp(pct, 0, 100);
        AppState.getEl('progressPercent').innerText = displayPct.toFixed(1) + '%';
        
        const remaining = MathUtil.diff(currentW, AppState.settings.goal1);
        const remainingDisplay = AppState.getEl('remainingWeightDisplay');
        remainingDisplay.innerText = `${remaining > 0 ? remaining : 0}kg`;
        DomUtil.setTextColor(remainingDisplay, remaining <= 0 ? 'secondary' : 'default');

        let remainingPct = 0;
        if(totalGap !== 0) {
            remainingPct = (remaining / totalGap * 100);
            if(remainingPct < 0) remainingPct = 0;
        }
        AppState.getEl('remainingPercentDisplay').innerText = `${remainingPct.toFixed(1)}%`;

        const heightM = AppState.settings.height / 100;
        const bmi = s.bmi !== undefined ? s.bmi : (heightM > 0 ? currentW / (heightM * heightM) : 0);
        
        let bmiLabel = '정상';
        if(bmi < CONFIG.BMI.UNDER) bmiLabel = '저체중';
        else if(bmi < CONFIG.BMI.NORMAL_END) bmiLabel = '정상';
        else if(bmi < CONFIG.BMI.PRE_OBESE_END) bmiLabel = '비만 전 단계 (과체중, 위험 체중)';
        else if(bmi < CONFIG.BMI.OBESE_1_END) bmiLabel = '1단계 비만';
        else if(bmi < CONFIG.BMI.OBESE_2_END) bmiLabel = '2단계 비만';
        else bmiLabel = '3단계 비만 (고도 비만)';
        
		AppState.getEl('bmiDisplay').innerText = `BMI: ${bmi.toFixed(2)} (${bmiLabel})`;
        updateBmiProgressBar(parseFloat(bmi), bmiLabel);

        const percentLost = ((AppState.settings.startWeight - currentW) / AppState.settings.startWeight * 100);
        AppState.getEl('percentLostDisplay').innerText = `(시작 체중 대비 ${percentLost > 0 ? '-' : '+'}${Math.abs(percentLost).toFixed(1)}%)`;

        updateProgressBar(currentW, totalLost, pct, remaining);

        AppState.getEl('streakDisplay').innerText = (s.maxStreak || 0) + '일';
        AppState.getEl('successRateDisplay').innerText = (s.successRate || 0) + '%';
        
        const pred = calculateScenarios(currentW);
        AppState.getEl('predictedDate').innerText = hasRecords ? pred.avg : '데이터 부족';
        AppState.getEl('predictionRange').innerText = hasRecords ? pred.range : '체중 기록을 추가해주세요';
        
        const rate7 = s.rate7 || '-';
        const rate30 = s.rate30 || '-';
        AppState.getEl('rate7Days').innerText = rate7;
        AppState.getEl('rate30Days').innerText = rate30;
        AppState.getEl('dashboardRate7Days').innerText = rate7;
        AppState.getEl('dashboardRate30Days').innerText = rate30;
        AppState.getEl('weeklyCompareDisplay').innerText = s.weeklyComp || '데이터 부족';

        AppState.getEl('minMaxWeightDisplay').innerHTML = hasRecords ? `
            <span class="text-danger">${s.max.toFixed(1)}kg</span> / 
            <span class="text-primary">${s.min.toFixed(1)}kg</span>
        ` : '- / -';
        
        AppState.getEl('dailyVolatilityDisplay').innerHTML = AppState.records.length > 1 ? `
            <span class="text-primary">▼${(s.maxDrop||0).toFixed(1)}</span> / 
            <span class="text-danger">▲${(s.maxGain||0).toFixed(1)}</span>
        ` : '- / -';

        AppState.getEl('weeklyAvgDisplay').innerText = (s.weeklyAvgLoss !== undefined && s.weeklyAvgLoss !== '-') ? s.weeklyAvgLoss + 'kg' : '-';
        
		const mCompEl = AppState.getEl('monthCompareDisplay');
        // [수정] 값이 없으면(undefined) 기본값 '-'을 사용하여 에러 방지
        const mCompText = s.monthlyComp || '-'; 
        mCompEl.innerText = mCompText;
        DomUtil.setTextColor(mCompEl, mCompText.includes('▼') ? 'primary' : (mCompText.includes('▲') ? 'danger' : 'default'));
		
        const cvEl = AppState.getEl('cvDisplay');
        if(cvEl) {
            const cv = s.cv || 0;
            cvEl.innerText = cv.toFixed(2) + '%';
            let cvColor = 'default';
            if(cv < 1) cvColor = 'primary'; // 매우 안정
            else if(cv > 3) cvColor = 'danger'; // 불안정
            DomUtil.setTextColor(cvEl, cvColor);
        }
    }

    function renderNewStats(s) {
        if(AppState.records.length === 0) return;

        const lastRec = s.lastRec;
        const currentW = lastRec.weight;

        const maEl = AppState.getEl('maDisparityDisplay');
        if(AppState.records.length >= 7) {
            const last7 = AppState.records.slice(-7);
            const avg7 = last7.reduce((a,b)=>a+b.weight, 0) / 7;
            const disparity = MathUtil.diff(currentW, avg7);
            maEl.innerText = (disparity > 0 ? '+' : '') + disparity.toFixed(2) + 'kg';
            DomUtil.setTextColor(maEl, disparity > 0 ? 'danger' : 'primary');

            // --- [NEW] v3.0.71 Trend Deviation ---
            const trendDevEl = AppState.getEl('trendDeviationDisplay');
            if(trendDevEl) {
                trendDevEl.innerHTML = `
                    <span class="${disparity > 1 ? 'text-danger' : (disparity < -0.5 ? 'text-primary' : '')}">
                        ${disparity > 0 ? '+' : ''}${disparity.toFixed(2)}kg
                    </span>
                `;
            }

        } else {
            maEl.innerText = '수집중';
            const trendDevEl = AppState.getEl('trendDeviationDisplay');
            if(trendDevEl) trendDevEl.innerText = '-';
        }

        const wClass = CONFIG.WEIGHT_CLASSES.find(c => currentW >= c.min);
        AppState.getEl('weightClassDisplay').innerText = wClass ? wClass.name : '미분류';

        let recoveries = [];
        for(let i=1; i<AppState.records.length-1; i++) {
            const diff = MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight);
            if(diff >= 0.5) { 
                const baseWeight = AppState.records[i-1].weight;
                let daysToRecover = 0;
                for(let j=i+1; j<AppState.records.length; j++) {
                    daysToRecover++;
                    if(AppState.records[j].weight <= baseWeight) {
                        recoveries.push(daysToRecover);
                        break;
                    }
                }
            }
        }
        AppState.getEl('recoveryScoreDisplay').innerText = recoveries.length > 0 ? (recoveries.reduce((a,b)=>a+b, 0) / recoveries.length).toFixed(1) + '일' : '-';

        if(lastRec && lastRec.fat) {
            const lbm = lastRec.weight * (1 - lastRec.fat/100);
            const hMeter = AppState.settings.height / 100;
            const lbmi = lbm / (hMeter * hMeter);
            AppState.getEl('lbmDisplay').innerText = lbm.toFixed(1) + 'kg';
            AppState.getEl('lbmiDisplay').innerText = `LBMI: ${lbmi.toFixed(1)}`;
            
            const bmiVal = currentW / (hMeter * hMeter);
            let metaAge = 25 + (bmiVal - 22) * 2 + (lastRec.fat - 20) * 0.5;
            if(metaAge < 18) metaAge = 18; 
            AppState.getEl('metabolicAgeDisplay').innerText = `약 ${Math.round(metaAge)}세`;
        } else {
            AppState.getEl('lbmDisplay').innerText = '-';
            AppState.getEl('lbmiDisplay').innerText = '체지방 입력 필요';
            AppState.getEl('metabolicAgeDisplay').innerText = '체지방 필요';
        }

        const startD = DateUtil.parse(AppState.records[0].date);
        const lastD = DateUtil.parse(lastRec.date);
        const dayDiff = Math.floor(DateUtil.daysBetween(startD, lastD));
        AppState.getEl('dDayDisplay').innerText = `Day ${dayDiff + 1}`;

        const recentRecs = AppState.records.slice(-14); 
        if(recentRecs.length > 2) {
            const first = recentRecs[0];
            const last = recentRecs[recentRecs.length-1];
            const days = DateUtil.daysBetween(DateUtil.parse(first.date), DateUtil.parse(last.date));
            if(days > 0) {
                const lossKg = MathUtil.diff(first.weight, last.weight);
                const dailyLoss = lossKg / days;
                const userIntake = AppState.settings.intake || 2000;
                const estimatedTdee = userIntake + (dailyLoss * 7700);
                AppState.getEl('estTdeeDisplay').innerText = `${Math.round(estimatedTdee)} kcal`;
                AppState.getEl('estTdeeSubDisplay').innerText = `(섭취 ${userIntake}kcal 가정)`;
                
                const calEffEl = AppState.getEl('calEfficiencyDisplay');
                if(calEffEl) {
                    const actualDeficit = dailyLoss * 7700;
                    const eff = (actualDeficit / estimatedTdee) * 100;
                    calEffEl.innerText = `${eff.toFixed(1)}%`;
                }

                const maEl = AppState.getEl('metabolicAdaptDisplay');
                if(maEl) {
                    const expectedLossKg = (estimatedTdee - userIntake) / 7700;
                    const diff = dailyLoss - expectedLossKg; 
                    if (diff < -0.05) maEl.innerText = "대사 저하 의심";
                    else maEl.innerText = "정상 범위";
                }

            } else {
                AppState.getEl('estTdeeDisplay').innerText = '-';
                const calEffEl = AppState.getEl('calEfficiencyDisplay');
                if(calEffEl) calEffEl.innerText = '-';
                const maEl = AppState.getEl('metabolicAdaptDisplay');
                if(maEl) maEl.innerText = '-';
            }
        } else {
            AppState.getEl('estTdeeDisplay').innerText = '데이터 수집중';
            const calEffEl = AppState.getEl('calEfficiencyDisplay');
            if(calEffEl) calEffEl.innerText = '-';
            const maEl = AppState.getEl('metabolicAdaptDisplay');
            if(maEl) maEl.innerText = '-';
        }

        const totalLost = MathUtil.diff(AppState.settings.startWeight, s.current);
        const totalDays = DateUtil.daysBetween(startD, lastD) || 1;
        const weeklyEff = (totalLost / totalDays) * 7;
        AppState.getEl('weeklyEffDisplay').innerText = `${weeklyEff.toFixed(2)} kg/주`;

        if(totalLost > 0) {
            const cost = totalDays / totalLost;
            AppState.getEl('dietCostDisplay').innerText = `${cost.toFixed(1)}일/kg`;
        } else {
            AppState.getEl('dietCostDisplay').innerText = '-';
        }

        const weekendImpacts = [];
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date);
            if(d.getDay() === 1) { 
                const prevFriDate = new Date(d);
                prevFriDate.setDate(d.getDate() - 3);
                const prevFriStr = DateUtil.format(prevFriDate);
                const prevFriRec = AppState.records.find(r => r.date === prevFriStr);
                if(prevFriRec) {
                    weekendImpacts.push(AppState.records[i].weight - prevFriRec.weight);
                }
            }
        }
        const wImpactEl = AppState.getEl('weekendImpactDisplay');
        if(weekendImpacts.length > 0) {
            const avgImpact = weekendImpacts.reduce((a,b)=>a+b,0) / weekendImpacts.length;
            const sign = avgImpact > 0 ? '+' : '';
            wImpactEl.innerText = `${sign}${avgImpact.toFixed(2)}kg`;
            DomUtil.setTextColor(wImpactEl, avgImpact > 0 ? 'danger' : 'primary');
        } else {
            wImpactEl.innerText = '-';
        }

        const shortTrendEl = AppState.getEl('shortTrendDisplay');
        if(AppState.records.length >= 3) {
            const r3 = AppState.records[AppState.records.length-3];
            const r1 = AppState.records[AppState.records.length-1];
            const diff3 = MathUtil.diff(r1.weight, r3.weight);
            let msg = "안정";
            if(diff3 < -0.4) msg = "📉 급하락";
            else if(diff3 < 0) msg = "↘ 하락세";
            else if(diff3 > 0.4) msg = "📈 급상승";
            else if(diff3 > 0) msg = "↗ 상승세";
            
            shortTrendEl.innerText = msg;
            DomUtil.setTextColor(shortTrendEl, diff3 > 0 ? 'danger' : (diff3 < 0 ? 'primary' : 'default'));
            
            const avgDiff3 = diff3 / 2; 
            const r3AvgEl = AppState.getEl('recent3DayAvgDisplay');
            if(r3AvgEl) r3AvgEl.innerText = `${(avgDiff3).toFixed(2)} kg/일`;
        } else {
            shortTrendEl.innerText = '-';
            const r3AvgEl = AppState.getEl('recent3DayAvgDisplay');
            if(r3AvgEl) r3AvgEl.innerText = '-';
        }

        const waterEl = AppState.getEl('waterIndexDisplay');
        if(AppState.records.length >= 7) {
             const last7 = AppState.records.slice(-7);
             const avg7 = last7.reduce((a,b)=>a+b.weight,0)/last7.length;
             const dev = MathUtil.diff(s.current, avg7);
             waterEl.innerText = (dev > 0 ? '+' : '') + dev.toFixed(1) + 'kg';
             DomUtil.setTextColor(waterEl, dev > 0.5 ? 'danger' : (dev < -0.5 ? 'primary' : 'default'));
             
             const startW7 = last7[0].weight;
             const endW7 = last7[last7.length-1].weight;
             const wSpeed = MathUtil.diff(endW7, startW7);
             const wSpeedEl = AppState.getEl('weeklySpeedDisplay');
             if(wSpeedEl) wSpeedEl.innerText = `${wSpeed.toFixed(2)} kg/주`;
             
             const stdDev7 = MathUtil.stdDev(last7.map(r=>r.weight));
             const volIdx = stdDev7 * 10;
             const volEl = AppState.getEl('volatilityIndexDisplay');
             if(volEl) volEl.innerText = volIdx.toFixed(1);

             let riskScore = 0;
             if(wSpeed < -1.5) riskScore += 40; 
             else if(wSpeed < -1.0) riskScore += 20;
             if(stdDev7 > 0.5) riskScore += 30; 
             if(dev > 1.0) riskScore += 30; 
             
             let riskLabel = '낮음';
             let riskColor = 'primary';
             if(riskScore >= 70) { riskLabel = '높음'; riskColor = 'danger'; }
             else if(riskScore >= 40) { riskLabel = '중간'; riskColor = 'accent'; }
             
             const yoyoEl = AppState.getEl('yoyoRiskDisplay');
             if(yoyoEl) {
                 yoyoEl.innerText = `${riskScore}점 (${riskLabel})`;
                 DomUtil.setTextColor(yoyoEl, riskColor);
             }
             
             const ptEl = AppState.getEl('paperTowelDisplay');
             if(ptEl) {
                 const dailyRate = Math.abs(wSpeed / 7);
                 if (dailyRate > 0) {
                    const onePercent = s.current * 0.01;
                    const days = onePercent / dailyRate;
                    ptEl.innerText = `${days.toFixed(1)}일`;
                 } else {
                     ptEl.innerText = '유지/증량 중';
                 }
             }

        } else {
            waterEl.innerText = '-';
            const wSpeedEl = AppState.getEl('weeklySpeedDisplay');
            if(wSpeedEl) wSpeedEl.innerText = '-';
            const volEl = AppState.getEl('volatilityIndexDisplay');
            if(volEl) volEl.innerText = '-';
            const yoyoEl = AppState.getEl('yoyoRiskDisplay');
            if(yoyoEl) yoyoEl.innerText = '-';
            const ptEl = AppState.getEl('paperTowelDisplay');
            if(ptEl) ptEl.innerText = '-';
        }

        const startRecWithFat = AppState.records.find(r => r.fat);
        if(startRecWithFat && lastRec.fat) {
             const startFatKg = startRecWithFat.weight * (startRecWithFat.fat/100);
             const currFatKg = lastRec.weight * (lastRec.fat/100);
             const fatLoss = MathUtil.diff(startFatKg, currFatKg);
             
             const startLeanKg = startRecWithFat.weight * (1 - startRecWithFat.fat/100);
             const currLeanKg = lastRec.weight * (1 - lastRec.fat/100);
             const leanLoss = MathUtil.diff(startLeanKg, currLeanKg);
             
             const totalLoss = fatLoss + leanLoss;
             const fatRatio = totalLoss > 0 ? (fatLoss/totalLoss)*100 : 0;
             
             AppState.getEl('netChangeDisplay').innerText = `지방 ${fatLoss.toFixed(1)}kg 감량`;
             AppState.getEl('netChangeSubDisplay').innerText = `(감량분의 ${Math.round(fatRatio)}%가 지방)`;
             
             const balance = (currLeanKg / currFatKg).toFixed(2);
             const balEl = AppState.getEl('bodyCompBalanceDisplay');
             if(balEl) balEl.innerText = `${balance} : 1`;
             
             const trendEl = AppState.getEl('bodyCompTrendDisplay');
             if(trendEl) trendEl.innerText = `근육 ${leanLoss > 0 ? '-' : '+'}${Math.abs(leanLoss).toFixed(1)}kg`;
             
             const mlCard = AppState.getEl('muscleLossCard');
             const mlDisplay = AppState.getEl('muscleLossDisplay');
             if(mlCard) {
                 if (leanLoss > 0 && totalLoss > 2 && (leanLoss / totalLoss) > 0.4) {
                     mlCard.style.display = 'block';
                     mlDisplay.innerText = `${((leanLoss/totalLoss)*100).toFixed(0)}% 근손실`;
                     DomUtil.setTextColor(mlDisplay, 'danger');
                 } else {
                     mlCard.style.display = 'none';
                 }
             }

             // --- [NEW] v3.0.71 LBM Retention ---
             const lbmRetEl = AppState.getEl('lbmRetentionDisplay');
             if(lbmRetEl) {
                 if (totalLoss > 0) {
                    const lbmRetention = ((totalLoss - Math.max(0, leanLoss)) / totalLoss) * 100;
                    lbmRetEl.innerText = `${lbmRetention.toFixed(1)}%`;
                 } else {
                     lbmRetEl.innerText = '-';
                 }
             }

        } else {
             AppState.getEl('netChangeDisplay').innerText = '-';
             AppState.getEl('netChangeSubDisplay').innerText = '체지방 데이터 필요';
             const balEl = AppState.getEl('bodyCompBalanceDisplay');
             if(balEl) balEl.innerText = '-';
             const trendEl = AppState.getEl('bodyCompTrendDisplay');
             if(trendEl) trendEl.innerText = '-';
             const mlCard = AppState.getEl('muscleLossCard');
             if(mlCard) mlCard.style.display = 'none';
             const lbmRetEl = AppState.getEl('lbmRetentionDisplay');
             if(lbmRetEl) lbmRetEl.innerText = '-';
        }

        // --- [NEW] v3.0.71 Sodium Warning ---
        const sodEl = AppState.getEl('sodiumWarningDisplay');
        if(sodEl && AppState.records.length >= 2) {
            const diff = AppState.records[AppState.records.length-1].weight - AppState.records[AppState.records.length-2].weight;
            if (diff > 1.5) {
                sodEl.innerText = "🚨 급등 감지";
                DomUtil.setTextColor(sodEl, 'danger');
            } else {
                sodEl.innerText = "정상";
                DomUtil.setTextColor(sodEl, 'default');
            }
        }

        // --- [NEW] v3.0.71 CV Status ---
        const cvStatEl = AppState.getEl('cvStatusDisplay');
        if(cvStatEl) {
            const cv = s.cv || 0;
            let status = '보통';
            let color = 'default';
            if (cv < 1) { status = '매우 안정'; color = 'primary'; }
            else if (cv > 3) { status = '과도함'; color = 'danger'; }
            cvStatEl.innerText = status;
            DomUtil.setTextColor(cvStatEl, color);
        }

        const now = new Date();
        const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(now.getDate()-30);
        const recentRecs30 = AppState.records.filter(r => DateUtil.parse(r.date) >= thirtyDaysAgo);
        const uniqueDays = new Set(recentRecs30.map(r => r.date)).size;
        const score = Math.min(100, Math.round((uniqueDays / 30) * 100));
        AppState.getEl('consistencyDisplay').innerText = `${score}%`;
        
        const lcEl = AppState.getEl('lossConsistencyDisplay');
        if(recentRecs30.length > 1) {
            let lossDays = 0;
            for(let i=1; i<recentRecs30.length; i++) {
                if(recentRecs30[i].weight < recentRecs30[i-1].weight) lossDays++;
            }
            const lossConsistency = (lossDays / (recentRecs30.length - 1)) * 100;
            if(lcEl) lcEl.innerText = `${lossConsistency.toFixed(0)}%`;
        } else {
            if(lcEl) lcEl.innerText = '-';
        }

        const remW = MathUtil.diff(s.current, AppState.settings.goal1);
        const defEl = AppState.getEl('deficitDisplay');
        const idealWEl = AppState.getEl('idealWeeklyRateDisplay');
        
        if(remW > 0) {
            const calToLose = remW * 7700;
            const daysToGoal = 90;
            const reqDeficit = Math.round(calToLose / daysToGoal);
            defEl.innerText = `-${reqDeficit} kcal/일`;
            
            const idealWeekly = (remW / (daysToGoal / 7)).toFixed(2);
            if(idealWEl) idealWEl.innerText = `-${idealWeekly} kg/주`;
        } else {
             defEl.innerText = '목표 달성!';
             if(idealWEl) idealWEl.innerText = '완료';
        }

        if(lastRec.fat) {
            const hMeter = AppState.settings.height/100;
            const lbm = lastRec.weight * (1 - lastRec.fat/100);
            const ffmi = lbm / (hMeter * hMeter);
            AppState.getEl('ffmiDisplay').innerText = ffmi.toFixed(1);
        } else {
             AppState.getEl('ffmiDisplay').innerText = '-';
        }

        const hMeter = AppState.settings.height / 100;
        const currentBmi = s.current / (hMeter * hMeter);
        const bpEl = AppState.getEl('bmiPrimeDisplay');
        if(bpEl) {
            const prime = currentBmi / 23;
            bpEl.innerText = prime.toFixed(2);
            DomUtil.setTextColor(bpEl, prime <= 1.0 ? 'primary' : 'danger');
        }

        const surplusEl = AppState.getEl('surplusCalDisplay');
        if(surplusEl) {
            let surplus = 0;
            for(let i=1; i<AppState.records.length; i++) {
                const diff = AppState.records[i].weight - AppState.records[i-1].weight;
                if(diff > 0) surplus += (diff * 7700);
            }
            surplusEl.innerText = `+${Math.round(surplus).toLocaleString()} kcal`;
        }
    }

	function renderAdvancedText(s) {
        if(AppState.records.length < 5) {
            DomUtil.setSafeHtml(AppState.getEl('advancedAnalysisList'), '<li class="insight-item">데이터가 5개 이상 쌓이면 분석을 제공합니다.</li>');
            return;
        }

        let htmlLines = [];
        const { PERSONA } = CONFIG.MESSAGES;

        // --- 공통 변수 정의 (추가된 로직용) ---
        const totalLost = s.totalLost || 0;
        const current = s.current || 0;
        const maxPlateau = s.maxPlateau || 0;
        const lastRec = s.lastRec || {};
        const dayNames = ['일','월','화','수','목','금','토'];

        // 1. 다이어트 성향 (Persona)
        const stdDev = s.stdDev || 0;
        let persona = "";
        if(stdDev > 0.8) persona = PERSONA.ROLLER;
        else if(stdDev < 0.3) persona = PERSONA.TURTLE;
        else persona = PERSONA.BALANCE;
        
        let weekendSpike = 0;
        for(let i=1; i<AppState.records.length; i++) {
             const d = DateUtil.parse(AppState.records[i].date).getDay();
             if(d === 1 && AppState.records[i].weight > AppState.records[i-1].weight + 0.5) weekendSpike++;
        }
        if(weekendSpike >= 3) persona = PERSONA.WEEKEND;
        htmlLines.push(`<li class="insight-item"><span class="insight-label">🕵️ 다이어트 성향:</span> 당신은 <strong>${persona}</strong>입니다.</li>`);

		// 2. 수분 마스킹 (Water Masking) & 3. 상승 다이어트 (Lean Mass Up)
        if(AppState.records.length >= 3) {
            const last = AppState.records[AppState.records.length-1];
            const prev = AppState.records[AppState.records.length-2];
            
            // 조건: 체지방 정보가 있고, 체지방은 줄었으나(▼), 체중은 같거나 늘어남(▲ or =)
            if(last.fat && prev.fat && last.fat < prev.fat && last.weight >= prev.weight) {
                const wDiff = last.weight - prev.weight;

                if (wDiff > 0) {
                    // 체중이 증가한 경우 (+0.1kg 이상)
                    htmlLines.push(`<li class="insight-item text-primary"><span class="insight-label">💪 상승 다이어트:</span> "체중이 +${wDiff.toFixed(1)}kg 늘었지만 슬퍼하지 마세요! 체지방률은 오히려 떨어졌습니다. 근육이 늘고 지방이 타는 가장 이상적인 '상승 다이어트' 중입니다."</li>`);
                } else {
                    // 체중이 정확히 같은 경우 (0.0kg)
                    htmlLines.push(`<li class="insight-item text-primary"><span class="insight-label">🧱 체성분 재구성:</span> "체중은 어제와 똑같지만 체지방률은 떨어졌습니다! 지방이 빠진 자리를 근육이나 수분이 채우고 있는 긍정적인 신호(린매스업)입니다."</li>`);
                }
            }
        }
		
        // 4. 골든 크로스 / 데드 크로스 (Golden/Dead Cross)
        if(AppState.records.length >= 30) {
            const last7 = AppState.records.slice(-7).reduce((a,b)=>a+b.weight,0)/7;
            const last30 = AppState.records.slice(-30).reduce((a,b)=>a+b.weight,0)/30;
            const prevRecs = AppState.records.slice(0, AppState.records.length-1);
            if(prevRecs.length >= 30) {
                const prev7 = prevRecs.slice(-7).reduce((a,b)=>a+b.weight,0)/7;
                const prev30 = prevRecs.slice(-30).reduce((a,b)=>a+b.weight,0)/30;
                
                if(prev7 >= prev30 && last7 < last30) {
                    htmlLines.push(`<li class="insight-item text-primary"><span class="insight-label">📉 골든 크로스:</span> "🎉 축하합니다! 오늘부로 단기 감량 추세가 장기 추세를 앞질렀습니다. 지금부터 본격적인 '가속 감량 구간'에 진입했습니다."</li>`);
                } else if (prev7 <= prev30 && last7 > last30) {
                    htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">📈 데드 크로스:</span> 단기 이동평균이 장기 이동평균을 뚫고 올라갔습니다! 상승 추세 전환을 주의하세요.</li>`);
                }
            }
        }

        // 5. 요일별 승률 (Day of Week Win Rate)
        const dayDeltas = [0,0,0,0,0,0,0]; 
        const dayCounts = [0,0,0,0,0,0,0];
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date).getDay();
            const diff = MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight);
            dayDeltas[d] += diff;
            dayCounts[d]++;
        }
        const dayAvgs = dayDeltas.map((sum, i) => dayCounts[i] ? sum/dayCounts[i] : 0);
        const bestDayIdx = dayAvgs.indexOf(Math.min(...dayAvgs));
        const worstDayIdx = dayAvgs.indexOf(Math.max(...dayAvgs));
        // const dayNames = ['일','월','화','수','목','금','토']; // 위에서 이미 선언됨
        
        htmlLines.push(`<li class="insight-item"><span class="insight-label">🧐 요일 승률:</span> 
            <strong>${dayNames[bestDayIdx]}요일</strong>에 가장 잘 빠지고, 
            <strong>${dayNames[worstDayIdx]}요일</strong>에 주의가 필요합니다.</li>`);

        // 6. 패턴 감지 (Cycle Pattern)
        let cyclePattern = false;
        if(AppState.records.length > 60) {
            let spikeCount = 0;
            const reversed = [...AppState.records].reverse();
            for(let i=0; i<reversed.length-30; i+=28) {
                let hasGain = false;
                for(let j=0; j<5; j++) {
                    if(i+j+1 < reversed.length && reversed[i+j].weight > reversed[i+j+1].weight + 0.5) hasGain = true;
                }
                if(hasGain) spikeCount++;
            }
            if(spikeCount >= 2) cyclePattern = true;
        }
        if(cyclePattern) {
            htmlLines.push(`<li class="insight-item"><span class="insight-label">🔄 패턴 감지:</span> "약 28일 주기로 체중이 일시적으로 증가하는 패턴이 감지됩니다. 자연스러운 현상이니 당황하지 마세요."</li>`);
        }

        // 8. 리바운드 경고 (Rebound Warning)
        if(AppState.records.length >= 3) {
            const last3 = AppState.records.slice(-3);
            const drop3 = last3[0].weight - last3[2].weight;
            if(drop3 >= 2.0) {
                htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">⚠️ 리바운드 경고:</span> "최근 급격한 감량(-${drop3.toFixed(1)}kg/3일)이 있었습니다. 통계적으로 이런 급감 후에는 48시간 내에 반등할 확률이 높습니다. 식단에 유의하세요."</li>`);
            }
        }

        // 9. 시즈널리티 (Seasonality)
        const monthlyGains = {};
        for(let i=1; i<AppState.records.length; i++) {
            const m = DateUtil.parse(AppState.records[i].date).getMonth() + 1;
            const diff = AppState.records[i].weight - AppState.records[i-1].weight;
            if(!monthlyGains[m]) monthlyGains[m] = 0;
            monthlyGains[m] += diff;
        }
        let worstMonth = -1, maxVal = -999;
        Object.keys(monthlyGains).forEach(m => {
            if(monthlyGains[m] > maxVal) { maxVal = monthlyGains[m]; worstMonth = Number(m); }
        });
        if(maxVal > 1.0) {
            htmlLines.push(`<li class="insight-item"><span class="insight-label">🍂 시즈널리티:</span> "<strong>${worstMonth}월</strong>에 체중이 증가하는 경향이 있습니다. 해당 시기에 활동량 저하를 주의하세요."</li>`);
        }

        // 10. 치팅 여파 (Cheating Recovery)
        const recoveries = [];
        for(let i=1; i<AppState.records.length; i++) {
            const diff = MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight);
            if(diff >= 0.4) {
                const spikeDay = DateUtil.parse(AppState.records[i].date).getDay();
                for(let j=i+1; j<Math.min(i+7, AppState.records.length); j++) {
                    if(AppState.records[j].weight <= AppState.records[i-1].weight) {
                        const recoveryDay = DateUtil.parse(AppState.records[j].date).getDay();
                        recoveries.push({ spike: spikeDay, recovery: recoveryDay });
                        break;
                    }
                }
            }
        }
        if(recoveries.length > 0) {
            const counts = {};
            recoveries.forEach(r => {
                const key = `${dayNames[r.spike]}요일에 찐 살은 보통 ${dayNames[r.recovery]}요일`;
                counts[key] = (counts[key] || 0) + 1;
            });
            const bestPattern = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
            htmlLines.push(`<li class="insight-item"><span class="insight-label">🍔 치팅 여파:</span> "${bestPattern}에 다 빠집니다."</li>`);
        }

        // 11. 구간 분석 (Zone Analysis)
        const zones = {};
        for(let i=10; i<AppState.records.length; i++) {
            const zone = Math.floor(AppState.records[i].weight);
            if(!zones[zone]) zones[zone] = [];
            const diff = MathUtil.diff(AppState.records[i-1].weight, AppState.records[i].weight);
            zones[zone].push(diff);
        }
        const zoneStats = Object.keys(zones).map(z => {
            return { zone: z, avg: zones[z].reduce((a,b)=>a+b,0)/zones[z].length };
        }).sort((a,b) => b.avg - a.avg);

        if(zoneStats.length >= 2) {
            const best = zoneStats[0];
            const worst = zoneStats[zoneStats.length-1];
            htmlLines.push(`<li class="insight-item"><span class="insight-label">📉 구간 분석:</span> "${best.zone}kg대에서 가장 빠르게 감량되었습니다. ${worst.zone}kg대에서는 상대적으로 속도가 느려집니다."</li>`);
        }

        // 12. 최장 정체기 (Longest Plateau)
        // let maxPlateau = 0; // 상단에서 공통 변수로 선언됨
        let currPlateau = 0;
        let localMaxPlateau = 0; // 변수명 충돌 방지
        for(let i=1; i<AppState.records.length; i++) {
            const diff = Math.abs(MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight));
            if(diff < 0.2) currPlateau++;
            else currPlateau = 0;
            if(currPlateau > localMaxPlateau) localMaxPlateau = currPlateau;
        }
        if(localMaxPlateau >= 3) {
            htmlLines.push(`<li class="insight-item"><span class="insight-label">⏳ 최장 정체기:</span> 체중 변화가 거의 없던 최장 기간은 <strong>${localMaxPlateau}일</strong> 입니다.</li>`);
        }

        // 13. 요요 인덱스 (Yoyo Index)
        if(s.diffs && s.diffs.length > 0) {
            const mean = s.diffs.reduce((a,b)=>a+b,0)/s.diffs.length;
            const variance = s.diffs.reduce((a,b)=>a+Math.pow(b-mean,2),0)/s.diffs.length;
            const stdDevDiff = Math.sqrt(variance);
            let volScore = Math.max(0, 100 - (stdDevDiff * 50)); 
            let volMsg = volScore > 80 ? "매우 안정적" : (volScore > 50 ? "보통" : "롤러코스터 🎢");
            htmlLines.push(`<li class="insight-item"><span class="insight-label">🎢 요요 인덱스:</span> 변동성 점수 <strong>${Math.round(volScore)}점</strong> (${volMsg}) 입니다.</li>`);
        }

        // 14. 신뢰도 구간 (Confidence Interval)
        const remaining = s.current - AppState.settings.goal1;
        if(remaining > 0) {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 30);
            
            let recentStartRecord = AppState.records.find(r => DateUtil.parse(r.date) >= cutoffDate);
            const useFullHistory = !recentStartRecord || 
                                  (AppState.records.indexOf(AppState.records[AppState.records.length-1]) - AppState.records.indexOf(recentStartRecord) < 3);

            if(useFullHistory) {
                recentStartRecord = AppState.records[0];
            }

            const rStartD = DateUtil.parse(recentStartRecord.date);
            const rLastD = DateUtil.parse(s.lastRec.date);
            const rDays = DateUtil.daysBetween(rStartD, rLastD) || 1;
            
            const currentSpeed = (recentStartRecord.weight - s.current) / rDays;

            if(currentSpeed > 0.01) {
                const daysCur = remaining / currentSpeed;
                
                const dEarly = new Date(); dEarly.setDate(dEarly.getDate() + daysCur * 0.9);
                const dLate = new Date(); dLate.setDate(dLate.getDate() + daysCur * 1.1);
                
                htmlLines.push(`<li class="insight-item"><span class="insight-label">🎯 신뢰도 구간:</span> "현재 속도라면 90% 확률로 <strong>${DateUtil.format(dEarly)}</strong>에서 <strong>${DateUtil.format(dLate)}</strong> 사이에 목표를 달성합니다."</li>`);
            } 
        }

        // 15. 월간 성적표 (Monthly Grade)
        const now = new Date();
        const thisMonthKey = DateUtil.format(now).slice(0, 7);
        const thisMonthRecs = AppState.records.filter(r => r.date.startsWith(thisMonthKey));
        if(thisMonthRecs.length > 3) {
            const startW = thisMonthRecs[0].weight;
            const endW = thisMonthRecs[thisMonthRecs.length-1].weight;
            const loss = MathUtil.diff(startW, endW);
            const uniqueDays = new Set(thisMonthRecs.map(r => r.date)).size;
            const daysInMonth = now.getDate();
            const consistency = (uniqueDays / daysInMonth) * 100;
            
            let grade = 'C';
            if(loss > 2 && consistency > 80) grade = 'A+';
            else if(loss > 1 && consistency > 60) grade = 'B';
            else if(loss < 0) grade = 'D';

            htmlLines.push(`<li class="insight-item"><span class="insight-label">🗓️ 월간 성적표:</span> 이번 달 성적은 <strong>${grade}</strong>입니다! (감량 ${loss.toFixed(1)}kg)</li>`);
        }

        // 16. 요요 위험도 경고 (Rapid Drop Warning)
        if(AppState.records.length > 7) {
            const last7 = AppState.records.slice(-7);
            const totalDrop = MathUtil.diff(last7[0].weight, last7[last7.length-1].weight);
            if(totalDrop > 2.0) { 
                htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">🔄 요요 위험도 경고:</span> 최근 감량 속도가 너무 빠릅니다. 급격한 감량은 요요를 부를 수 있습니다.</li>`);
            }
        }

        // 17. 베스트 퍼포먼스 (Best Performance)
        if(AppState.records.length > 30) {
            let maxLoss30 = -999;
            let bestPeriod = '';
            for(let i=30; i<AppState.records.length; i++) {
                const prev = AppState.records[i-30];
                const curr = AppState.records[i];
                const diff = MathUtil.diff(prev.weight, curr.weight);
                if(diff > maxLoss30) {
                    maxLoss30 = diff;
                    bestPeriod = `${prev.date} ~ ${curr.date}`;
                }
            }
            if(maxLoss30 > 0) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">🏆 베스트 퍼포먼스:</span> <strong>${bestPeriod}</strong> 기간에 <strong>${maxLoss30.toFixed(1)}kg</strong> 감량한 기록이 있습니다.</li>`);
            }
        }

        // 18. 7일의 법칙 경고 (7-Day Law)
        if(dayAvgs[4] < 0 && (dayAvgs[5] > 0 || dayAvgs[6] > 0)) {
            htmlLines.push(`<li class="insight-item"><span class="insight-label">🗓️ 7일의 법칙 경고:</span> "지난 4주간 통계를 보니, 목요일까지 잘 빼다가 금~토에 다시 찌우는 패턴이 반복됩니다. 이번 주 금요일을 조심하세요!"</li>`);
        }

        // 19. 손절매 제안 (Stop Loss)
        let gainStreak = 0, gainSum = 0;
        for(let i=AppState.records.length-1; i>0; i--) {
            const diff = AppState.records[i].weight - AppState.records[i-1].weight;
            if(diff > 0) { gainStreak++; gainSum += diff; }
            else break;
        }
        if(gainStreak >= 3 && gainSum >= 1.5) {
             htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">📉 손절매(Stop Loss) 제안:</span> "최근 3일 연속 증량 중이며 총 +${gainSum.toFixed(1)}kg입니다. 통계적으로 오늘 식단을 조절하지 않으면 2주 전 체중으로 복귀할 확률이 높습니다."</li>`);
        }

        // 20. 가짜 정체기 판별 (Fake Plateau)
        if(maxPlateau >= 7) {
            const last7 = AppState.records.slice(-7);
            const trend = last7[last7.length-1].weight - (last7.reduce((a,b)=>a+b.weight,0)/7);
            if(Math.abs(last7[0].weight - last7[6].weight) < 0.2 && trend < 0) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">💊 가짜 정체기 판별:</span> "체중은 그대로지만, 7일 평균선은 미세하게 우하향 중입니다. 이것은 정체기가 아니라 '계단식 하락' 직전의 구간일 수 있습니다. 포기하지 마세요."</li>`);
            }
        }

        // 21. 후시 효과 예측 (Whoosh Prediction)
        if (maxPlateau > 10) {
             htmlLines.push(`<li class="insight-item text-primary"><span class="insight-label">⚠️ 후시(Whoosh) 효과 예측:</span> "장기간 정체기가 지속되고 있습니다. 이는 지방세포가 수분을 머금고 버티는 현상일 수 있으며, 곧 급격한 수분 배출과 함께 체중이 뚝 떨어질(Whoosh) 가능성이 높습니다."</li>`);
        }

        // 22. 추세 반전 감지 (Head & Shoulders)
        if (AppState.records.length > 20) {
            const recs = AppState.records.slice(-10);
            const mid = Math.floor(recs.length / 2);
            if (recs[0].weight < recs[mid].weight && recs[recs.length-1].weight < recs[mid].weight && recs[mid].weight > recs[0].weight + 1) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">📉 추세 반전 감지:</span> "최근 체중 패턴이 상승 후 하락세로 꺾이는 '헤드 앤 숄더' 패턴과 유사합니다. 증량 추세가 멈추고 다시 감량이 시작될 신호일 수 있습니다."</li>`);
            }
        }

        // 23. 치팅 회복력 (Cheating Resilience)
        if (recoveries.length > 2) {
             let recDurations = [];
             for(let i=1; i<AppState.records.length-1; i++) {
                 if(AppState.records[i].weight >= AppState.records[i-1].weight + 1.0) { 
                     for(let j=i+1; j<AppState.records.length; j++) {
                         if(AppState.records[j].weight <= AppState.records[i-1].weight) {
                             recDurations.push(DateUtil.daysBetween(DateUtil.parse(AppState.records[i].date), DateUtil.parse(AppState.records[j].date)));
                             break;
                         }
                     }
                 }
             }
             if(recDurations.length > 0) {
                 const avgRecDays = recDurations.reduce((a,b)=>a+b,0) / recDurations.length;
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">🍔 치팅 회복력:</span> "폭식(급격한 증량) 후 원상 복구하는데 평균 <strong>${avgRecDays.toFixed(1)}일</strong>이 걸립니다."</li>`);
             }
        }

        // 24. 거북이 vs 토끼 진단 (Turtle vs Rabbit - New Logic)
        if (AppState.records.length > 30) {
             const diffs = [];
             for(let i=1; i<AppState.records.length; i++) diffs.push(Math.abs(AppState.records[i].weight - AppState.records[i-1].weight));
             const diffStdDev = MathUtil.stdDev(diffs);
             let type = diffStdDev > 0.5 ? "토끼형(급빠급찐)" : "거북이형(꾸준함)";
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🐢 거북이 vs 토끼 진단:</span> "최근 1달 데이터를 보니, 천천히 꾸준히 빼는 '${type}'입니다. 급격한 감량보다는 현재 페이스 유지가 요요 방지에 유리합니다."</li>`);
        }

        // 25. 주말의 공격
        const satSpikes = [];
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date);
            if(d.getDay() === 6 && AppState.records[i].weight > AppState.records[i-1].weight) { // Sat spike
                 for(let j=i+1; j<AppState.records.length; j++) {
                     if(AppState.records[j].weight <= AppState.records[i-1].weight) {
                         satSpikes.push(DateUtil.daysBetween(DateUtil.parse(AppState.records[i].date), DateUtil.parse(AppState.records[j].date)));
                         break;
                     }
                 }
            }
        }
        if (satSpikes.length > 0) {
            const avgRec = satSpikes.reduce((a,b)=>a+b,0)/satSpikes.length;
            htmlLines.push(`<li class="insight-item"><span class="insight-label">🕵️ 주말의 공격:</span> " 주로 <strong>토요일</strong>에 체중이 늘어나고, 이를 복구하는 데 평균 <strong>${avgRec.toFixed(1)}일</strong>이 걸립니다. 주말 식단을 조절하면 목표 달성이 빨라집니다."</li>`);
        }

        // 26. 가짜 살 판독기 (Fake Weight Detector)
        // const lastRec = ... (상단 공통 변수 lastRec 사용)
        if (AppState.records.length > 7) {
            const lastRecVal = AppState.records[AppState.records.length-1].weight;
            const prevRecVal = AppState.records[AppState.records.length-2].weight;
            const diffLast = lastRecVal - prevRecVal;
            if (diffLast > 0) {
                const last7Avg = AppState.records.slice(-7).reduce((a,b)=>a+b.weight,0)/7;
                const prev7Avg = AppState.records.slice(-8, -1).reduce((a,b)=>a+b.weight,0)/7;
                if (last7Avg < prev7Avg) {
                     htmlLines.push(`<li class="insight-item"><span class="insight-label">📉 가짜 살 판독기:</span> "오늘 체중이 +${diffLast.toFixed(1)}kg 늘었지만, 최근 7일 평균선은 여전히 하락세입니다. 이는 단순 수분/변비일 확률이 95%입니다. 멘탈 잡으세요!"</li>`);
                }
            }
        }

        // 27. 시뮬레이션 예측 (Simulation)
        if (remaining > 0) {
             const rStart = AppState.records[0];
             const rEnd = s.lastRec;
             const rate = (rStart.weight - rEnd.weight) / (DateUtil.daysBetween(DateUtil.parse(rStart.date), DateUtil.parse(rEnd.date))||1);
             if(rate > 0) {
                 const timeOld = remaining / rate;
                 const timeNew = remaining / (rate + (300/7700));
                 const saved = timeOld - timeNew;
                 const targetDate = new Date(); targetDate.setDate(targetDate.getDate() + timeNew);
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">🔮 시뮬레이션 예측:</span> "만약 오늘부터 매일 300kcal씩 덜 먹는다면, 예상 목표 달성일은 <strong>${DateUtil.format(targetDate)}</strong>로 <strong>${Math.round(saved)}일</strong> 앞당겨집니다."</li>`);
             }
        }
        
        // 28. 정체기 타파 솔루션 (Plateau Solution)
        if (maxPlateau >= 10 && Math.abs(s.current - s.lastRec.weight) < 0.2) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">💡 정체기 타파 솔루션:</span> "현재 10일째 체중 변화가 없습니다. 지금은 <strong>운동 종류</strong>를 바꿔 대사에 충격을 줄 타이밍일 수 있습니다."</li>`);
        }

        // 29. 심리적 저항선 판독 (Psychological Resistance)
        const resistance = {}; 
        for(let i=1; i<AppState.records.length-1; i++) {
            if(AppState.records[i].weight > AppState.records[i-1].weight && AppState.records[i].weight > AppState.records[i+1].weight) {
                const z = Math.floor(AppState.records[i].weight);
                if(!resistance[z]) resistance[z] = 0;
                resistance[z]++;
            }
        }
        const topRes = Object.keys(resistance).sort((a,b)=>resistance[b]-resistance[a])[0];
        if(topRes && resistance[topRes] >= 3) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🧗‍♀️ 심리적 저항선 판독:</span> " <strong>${topRes}kg대</strong>에서 유독 3회 이상 반등한 기록이 있습니다. 이곳이 강력한 '심리적 저항선'입니다. 이번에 ${topRes}.9kg를 찍는 순간이 가장 중요합니다."</li>`);
        }
        
        // 30. 노이즈 캔슬링 (Noise Canceling)
        const lastRecVal = AppState.records[AppState.records.length-1].weight;
        const prevRecVal = AppState.records[AppState.records.length-2].weight;
        const diffLast = lastRecVal - prevRecVal;
        if (Math.abs(diffLast) > 0.6) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">📡 노이즈 캔슬링:</span> "오늘 체중이 급변했지만 무시하셔도 됩니다. 통계적으로 이 정도 변동은 평소 <strong>'일일 변동 허용 범위(±0.6kg)'</strong> 이내입니다. 전체 추세는 여전히 유효합니다."</li>`);
        }

        // 31. 시간 단축 마일리지 (Time Saved)
        if(remaining > 0 && AppState.records.length > 30) {
             const avgSpeed = (AppState.records[0].weight - s.current) / AppState.records.length;
             const recentSpeed = (AppState.records[AppState.records.length-8].weight - s.current) / 7;
             if(recentSpeed > avgSpeed) {
                 const daysSaved = (remaining/avgSpeed) - (remaining/recentSpeed);
                 if(daysSaved > 5) {
                     htmlLines.push(`<li class="insight-item"><span class="insight-label">⏳ 시간 단축 마일리지:</span> "지난주 불태우셨군요! 🔥 최근 속도라면 원래 예상보다 목표 달성을 <strong>${Math.round(daysSaved)}일</strong> 앞당길 수 있습니다."</li>`);
                 }
             }
        }

        // 32. 나트륨/부종 경보 (Sodium Alarm)
        if (diffLast > 2.0) {
             htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">🧂 나트륨/부종 경보:</span> "하루 만에 2kg가 찌는 것은 생물학적으로 불가능합니다(지방 2kg ≈ 15,400kcal). 이는 99% <strong>수분(부종)</strong>입니다. 오늘 물 많이 드시고 칼륨(바나나 등)을 섭취하면 내일 복구됩니다."</li>`);
        }
        
        // 33. 마의 N월 예보 (Month N Forecast)
        const nextMonth = new Date().getMonth() + 2 > 12 ? 1 : new Date().getMonth() + 2;
        if (monthlyGains[nextMonth] > 1.0) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🗓️ 마의 ${nextMonth}월 예보:</span> "곧 <strong>${nextMonth}월</strong>입니다. 데이터상 ${nextMonth}월마다 평균 <strong>${monthlyGains[nextMonth].toFixed(1)}kg</strong> 증량하는 패턴이 있습니다. 대비하세요!"</li>`);
        }

		// 34. 버티기 (Zone) 승리 예측 (Zone Victory)
        const currentZoneFloor = Math.floor(s.current / 10) * 10; 
        const distToNextZone = s.current - currentZoneFloor; 

        const d30 = new Date(); 
        d30.setDate(d30.getDate() - 30);
        const recentRecsForZone = AppState.records.filter(r => DateUtil.parse(r.date) >= d30);

        if (distToNextZone > 0 && recentRecsForZone.length > 5) {
             const firstR = recentRecsForZone[0];
             const lastR = recentRecsForZone[recentRecsForZone.length - 1];
             const periodDays = DateUtil.daysBetween(DateUtil.parse(firstR.date), DateUtil.parse(lastR.date));
             const weightLoss = firstR.weight - lastR.weight;

             if (weightLoss > 0 && periodDays > 0) {
                 const dailyRate = weightLoss / periodDays; 
                 const predictedDays = distToNextZone / dailyRate; 

                 if(predictedDays < 1000) {
                     htmlLines.push(`<li class="insight-item"><span class="insight-label">🧱 버티기 (Zone) 승리 예측:</span> "현재 페이스(${dailyRate.toFixed(2)}kg/일)라면 앞자리를 바꾸는 데 약 <strong>${Math.round(predictedDays)}일</strong>이 소요될 것으로 보입니다. ${currentZoneFloor}kg 진입까지 화이팅!"</li>`);
                 }
             } else if (weightLoss <= 0) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">🧱 버티기 (Zone) 승리 예측:</span> "현재 앞자리를 바꾸기 위해 ${distToNextZone.toFixed(1)}kg 감량이 필요합니다. 다시 감량 추세를 만들어봅시다!"</li>`);
             }
        }
		
        // 35. 과거의 영광 비교 (Past Glory)
        if(AppState.records.length > 60) {
             const mLoss = {};
             for(let i=1; i<AppState.records.length; i++) {
                 const k = AppState.records[i].date.substring(0, 7);
                 if(!mLoss[k]) mLoss[k] = 0;
                 mLoss[k] -= (AppState.records[i].weight - AppState.records[i-1].weight);
             }
             const bestMonth = Object.keys(mLoss).sort((a,b)=>mLoss[b]-mLoss[a])[0];
             if(bestMonth) {
                 const currentMonth = DateUtil.format(new Date()).substring(0,7);
                 if(mLoss[currentMonth] > mLoss[bestMonth] * 0.8) {
                      htmlLines.push(`<li class="insight-item"><span class="insight-label">🥉 과거의 영광 비교:</span> "이번 달 감량 속도는 역대 최고였던 <strong>${bestMonth}</strong>의 퍼포먼스와 유사합니다! 폼이 돌아왔습니다. 🔥"</li>`);
                 }
             }
        }

        // ---------------------------------------------------------
        // [추가] 36 ~ 85: 심층 분석 알고리즘 (Deep Insights)
        // ---------------------------------------------------------

        // 36. 스퀴즈 (Whoosh Effect 전조)
        if (AppState.records.length > 20) {
            const last7 = AppState.records.slice(-7).map(r => r.weight);
            const std7 = MathUtil.stdDev(last7);
            const last30 = AppState.records.slice(-30).map(r => r.weight);
            const std30 = MathUtil.stdDev(last30);
            
            if (std7 < std30 * 0.5) {
                htmlLines.push(`<li class="insight-item"><span class="insight-label">💧 폭풍전야 (Whoosh 대기):</span> "최근 7일간 체중 변화가 거의 없습니다. 지방은 탔지만 수분이 그 자리를 채우고 있을 가능성이 높습니다(Whoosh 효과). 포기하지 않으면 곧 급격한 감량이 찾아옵니다."</li>`);
            }
        }

        // 37. 급격한 변동 경고 (RSI 로직 응용)
        if (AppState.records.length > 14) {
            let gain = 0, loss = 0;
            const recent14 = AppState.records.slice(-15);
            for(let i=1; i<recent14.length; i++) {
                const change = recent14[i].weight - recent14[i-1].weight;
                if (change > 0) gain += change;
                else loss -= change;
            }
            const rs = loss === 0 ? 100 : gain / loss;
            const rsi = 100 - (100 / (1 + rs));
            
            if (rsi > 70) {
                htmlLines.push(`<li class="insight-item text-primary"><span class="insight-label">⏰ 급찐살 골든타임:</span> "최근 체중이 급격히 늘었습니다(과열). 의학적으로 이것은 지방보다 '수분과 글리코겐'일 확률이 높습니다. 지금 당장 조절하면 지방이 되기 전에 뺄 수 있습니다!"</li>`);
            } else if (rsi < 30) {
                htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">🚨 항상성 반발 경고:</span> "최근 감량 속도가 너무 빠릅니다. 우리 몸은 급격한 변화를 싫어해 식욕을 폭발시킬 수 있습니다(요요 현상). 오늘은 조금 더 드셔도 괜찮습니다."</li>`);
            }
        }

        // 38. 요요 경고 (Rebound Warning) 
        if (AppState.records.length > 30) {
            const periodRecs = AppState.records.slice(-30);
            const pMax = Math.max(...periodRecs.map(r => r.weight));
            const pMin = Math.min(...periodRecs.map(r => r.weight));
            const totalDrop = pMax - pMin;
            
            const regained = s.current - pMin;
            
            if (totalDrop > 2.0 && regained > totalDrop * 0.5) {
                htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">⚠️ 요요 경계령:</span> "최근 한 달간 힘들게 뺀 살의 <strong>절반 이상</strong>이 다시 쪘습니다. 단순한 변동이 아니라 '요요 현상'이 시작된 것일 수 있습니다. 다시 긴장감을 가지세요!"</li>`);
            } else if (totalDrop > 2.0 && regained > totalDrop * 0.3) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">🚧 주의 구간:</span> "최저 체중 대비 <strong>30% 정도</strong> 반등했습니다. 보상 심리로 인해 식단이 느슨해지지 않았는지 점검해보세요."</li>`);
            }
        }
        
        // 39. 월요병 증후군 (Monday Sickness)
        let monGains = 0, monCount = 0;
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date);
            if (d.getDay() === 1) { // 월요일
                if (AppState.records[i].weight > AppState.records[i-1].weight) monGains++;
                monCount++;
            }
        }
        if (monCount > 5 && (monGains / monCount) > 0.8) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">📅 월요병 증후군:</span> "월요일 아침마다 체중이 늘어날 확률이 <strong>${((monGains/monCount)*100).toFixed(0)}%</strong>입니다. 일요일 저녁 식사가 주범일 수 있습니다."</li>`);
        }

        // 40. 불금 효과 (TGIF)
        let friLosses = 0, friCount = 0;
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date);
            if (d.getDay() === 5) { // 금요일
                if (AppState.records[i].weight < AppState.records[i-1].weight) friLosses++;
                friCount++;
            }
        }
        if (friCount > 5 && (friLosses / friCount) > 0.8) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🎉 불금 효과:</span> "통계적으로 <strong>금요일 아침</strong> 체중이 가장 가볍습니다. 주중 관리를 매우 잘하고 계십니다!"</li>`);
        }

        // 41. 기록 공백 페널티 (Gap Penalty)
        let gapPenalty = 0;
        let gapCount = 0;
        for(let i=1; i<AppState.records.length; i++) {
            const days = DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date));
            if (days >= 3) {
                const diff = AppState.records[i].weight - AppState.records[i-1].weight;
                if (diff > 0) {
                    gapPenalty += diff;
                    gapCount++;
                }
            }
        }
        if (gapCount >= 2) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🕳️ 기록 공백의 법칙:</span> "3일 이상 기록을 쉴 때마다 평균 <strong>+${(gapPenalty/gapCount).toFixed(1)}kg</strong>씩 증량했습니다. 기록을 멈추면 살이 찝니다."</li>`);
        }

        // 42. 세트 포인트 저항 (Set Point Theory)
        const roundedWeights = AppState.records.map(r => Math.round(r.weight));
        const modeMap = {};
        let maxEl = roundedWeights[0], maxCount = 1;
        for(let i = 0; i < roundedWeights.length; i++) {
            const el = roundedWeights[i];
            if(modeMap[el] == null) modeMap[el] = 1;
            else modeMap[el]++;  
            if(modeMap[el] > maxCount) { maxEl = el; maxCount = modeMap[el]; }
        }
        if (Math.abs(s.current - maxEl) < 1 && maxCount > 20) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">⚓ 세트 포인트:</span> "현재 체중 <strong>${maxEl}kg</strong> 부근은 과거 가장 오래 머물렀던 구간입니다. 뇌가 이 체중을 '정상'으로 인식하여 강력히 저항 중입니다. 이 구간을 뚫으려면 평소와 다른 자극이 필요합니다."</li>`);
        }

        // 43. 마의 29/39/49... (Last Mile)
        const decimalPart = s.current - Math.floor(s.current);
        if (decimalPart >= 0.8 && decimalPart <= 0.9) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🏁 라스트 마일:</span> "다음 앞자리 숫자까지 얼마 안 남았습니다! 보통 <strong>.8 ~ .9kg</strong> 구간에서 심리적으로 해이해지기 쉽습니다. 끝까지 긴장하세요."</li>`);
        }

        // 45. 작심삼일 판독기
        if (AppState.records.length > 10) {
            let quitStreak3 = 0;
            for(let i=0; i<AppState.records.length-3; i++) {
                const d1 = DateUtil.parse(AppState.records[i].date);
                const d3 = DateUtil.parse(AppState.records[i+2].date);
                if (DateUtil.daysBetween(d1, d3) === 2) { 
                    const dNext = DateUtil.parse(AppState.records[i+3].date);
                    if (DateUtil.daysBetween(d3, dNext) >= 3) quitStreak3++;
                }
            }
            if (quitStreak3 >= 2) {
                htmlLines.push(`<li class="insight-item"><span class="insight-label">🔥 작심삼일 판독기:</span> "3일 기록 후 쉬는 패턴이 <strong>${quitStreak3}회</strong> 감지되었습니다. 4일차 고비를 넘기면 습관이 됩니다!"</li>`);
            }
        }

        // 48. 적금 만기 (Savings Maturity)
        const totalSavedCal = totalLost * 7700;
        if (totalLost > 0) {
            htmlLines.push(`<li class="insight-item"><span class="insight-label">💰 적금 만기:</span> "지금까지 누적 <strong>${totalSavedCal.toLocaleString()}kcal</strong>를 태웠습니다. 이는 빅맥 ${Math.round(totalSavedCal/550)}개에 해당하는 열량입니다."</li>`);
        }

        // 49. 급행열차 (Express Train)
        if (s.rate30 && parseFloat(s.rate30) < -100) { 
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🚅 급행열차 탑승:</span> "최근 한 달간 감량 속도가 매우 빠릅니다. 이 속도라면 일반인 상위 5% 안에 드는 감량 퍼포먼스입니다."</li>`);
        }

        // 50. 주말 방어율 (Weekend Defense Rate)
        const myWeekendImpacts = [];
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date);
            if(d.getDay() === 1) { 
                const prevFriDate = new Date(d); prevFriDate.setDate(d.getDate()-3);
                const prevFriStr = DateUtil.format(prevFriDate);
                const friRec = AppState.records.find(r => r.date === prevFriStr);
                if(friRec) myWeekendImpacts.push(AppState.records[i].weight - friRec.weight);
            }
        }
        if (myWeekendImpacts.length > 4) {
             const defended = myWeekendImpacts.filter(v => v <= 0).length;
             const rate = (defended / myWeekendImpacts.length) * 100;
             let grade = 'F';
             if (rate >= 80) grade = 'A';
             else if (rate >= 60) grade = 'B';
             else if (rate >= 40) grade = 'C';
             
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🛡️ 주말 방어율:</span> "당신의 주말 방어율(증량하지 않은 주말)은 <strong>${rate.toFixed(0)}% (${grade}학점)</strong>입니다."</li>`);
        }

        // 51. 다이버전스 (Divergence)
        if (AppState.records.length > 7 && s.lastRec.fat) {
             const r = AppState.records;
             const wTrend = r[r.length-1].weight - r[r.length-7].weight; 
             const fTrend = r[r.length-1].fat - r[r.length-7].fat; 
             
             if (wTrend < 0 && fTrend > 0) {
                 htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">⚠️ 하락 다이버전스:</span> "체중은 줄고 있지만 체지방률은 오르고 있습니다. 근손실이 의심됩니다. 단백질 섭취를 늘리세요."</li>`);
             } else if (wTrend > 0 && fTrend < 0) {
                 htmlLines.push(`<li class="insight-item text-primary"><span class="insight-label">💎 상승 다이버전스:</span> "체중은 늘었지만 체지방률은 떨어졌습니다. 근육량이 늘어나는 긍정적인 신호(린매스업)입니다."</li>`);
             }
        }

        // 53. 5일 이동평균선 돌파 (Moving Average Crossover)
        if (AppState.records.length > 6) {
            const last5Avg = AppState.records.slice(-6, -1).reduce((a,b)=>a+b.weight,0)/5;
            if (s.current < last5Avg && AppState.records[AppState.records.length-2].weight > last5Avg) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">📉 5일선 돌파:</span> "오늘 체중이 5일 이동평균선을 뚫고 내려갔습니다. 단기 하락 추세가 시작되었습니다."</li>`);
            } else if (s.current > last5Avg && AppState.records[AppState.records.length-2].weight < last5Avg) {
                 htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">📈 5일선 이탈:</span> "체중이 5일 이동평균선 위로 올라왔습니다. 단기 상승 추세로 전환될 수 있으니 주의하세요."</li>`);
            }
        }

        // 54. 3일 법칙 (The 3-Day Rule)
        let threeDayDrop = 0;
        for(let i=2; i<AppState.records.length; i++) {
             if(AppState.records[i].weight < AppState.records[i-1].weight && 
                AppState.records[i-1].weight < AppState.records[i-2].weight) threeDayDrop++;
        }
        const totalDrops = AppState.records.filter((r,i)=>i>0 && r.weight < AppState.records[i-1].weight).length;
        if(totalDrops > 0) {
            const prob = (threeDayDrop / totalDrops * 100).toFixed(0);
             htmlLines.push(`<li class="insight-item"><span class="insight-label">📉 관성의 법칙:</span> "체중이 이틀 연속 빠지면, 3일째에도 빠질 확률이 <strong>${prob}%</strong>입니다."</li>`);
        }

        // 55. 체중계 공포증 (Scale Phobia)
        let skipAfterGain = 0;
        let gainEvents = 0;
        for(let i=1; i<AppState.records.length-2; i++) {
            if (AppState.records[i].weight > AppState.records[i-1].weight + 0.5) {
                 gainEvents++;
                 const nextDay = DateUtil.addDays(AppState.records[i].date, 1);
                 if (AppState.records[i+1].date !== nextDay) {
                     skipAfterGain++;
                 }
            }
        }
        if (gainEvents > 3 && (skipAfterGain/gainEvents) > 0.5) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🫣 타조 효과 (Ostrich Effect):</span> "체중이 많이 늘어난 다음날은 기록을 건너뛰는 경향(${((skipAfterGain/gainEvents)*100).toFixed(0)}%)이 있습니다. 외면하지 말고 직면해야 해결됩니다!"</li>`);
        }

		// 56. BMI 클래스 변경 임박 (Proximity)
        const h = AppState.settings.height / 100;
        const currentBMI = s.current / (h*h);
        const thresholds = Object.values(CONFIG.BMI);
        let closestDist = 999;
        let targetBMI = 0;
        
        thresholds.forEach(t => {
            const dist = currentBMI - t;
            // 현재 BMI가 기준선보다 높고(빼야 함), 그 차이가 1.0 미만일 때
            if (dist > 0 && dist < 1.0 && dist < closestDist) {
                closestDist = dist;
                targetBMI = t;
            }
        });

        if (closestDist < 999) {
            const wToLose = (currentBMI - targetBMI) * h * h;
            
            let weightStr;
            // 1kg 미만이면 g 단위로 표시
            if (wToLose < 1.0) {
                // 0g으로 표시되는 것을 막기 위해 소수점 이하 올림 처리
                const grams = Math.ceil(wToLose * 1000); 
                weightStr = `${grams}g`;
            } else {
                weightStr = `${wToLose.toFixed(1)}kg`;
            }

             htmlLines.push(`<li class="insight-item"><span class="insight-label">🎖️ 승급 심사 임박:</span> "앞으로 <strong>${weightStr}</strong>만 더 빼면 BMI 단계가 내려갑니다! 비만도 등급이 바뀌는 순간입니다."</li>`);
        }
		
        // 58. 스키니 진 지수 (Skinny Jeans Index)
        if (AppState.records.length > 30) {
            let newLows = 0;
            let minW = AppState.records[0].weight;
            for(let i=1; i<AppState.records.length; i++) {
                if(AppState.records[i].weight < minW) {
                    minW = AppState.records[i].weight;
                    newLows++;
                }
            }
            const freq = (AppState.records.length / newLows).toFixed(1);
             htmlLines.push(`<li class="insight-item"><span class="insight-label">👖 스키니 진 지수:</span> "평균적으로 <strong>${freq}일</strong>마다 최저 체중을 경신하고 있습니다. 다음 신기록까지 화이팅!"</li>`);
        }

        // 59. 앵커링 효과 (Anchoring)
        if (totalLost > 5) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">⚓ 앵커링 탈출:</span> "이제 시작 체중(${AppState.settings.startWeight}kg)은 남의 얘기 같습니다. 뇌의 기준점이 성공적으로 낮아지고 있습니다."</li>`);
        }

        // 60. 파레토 법칙 (80/20 Rule)
        if (AppState.records.length > 20) {
            const dailyDrops = [];
            for(let i=1; i<AppState.records.length; i++) {
                const diff = AppState.records[i-1].weight - AppState.records[i].weight;
                if(diff > 0) dailyDrops.push(diff);
            }
            dailyDrops.sort((a,b)=>b-a);
            const top20Count = Math.ceil(dailyDrops.length * 0.2);
            const top20Sum = dailyDrops.slice(0, top20Count).reduce((a,b)=>a+b,0);
            const totalSum = dailyDrops.reduce((a,b)=>a+b,0);
            
            if (totalSum > 0) {
                const ratio = (top20Sum / totalSum * 100).toFixed(0);
                htmlLines.push(`<li class="insight-item"><span class="insight-label">📊 파레토 법칙:</span> "전체 감량의 <strong>${ratio}%</strong>가 상위 20%의 '황금 같은 날들'에 이루어졌습니다. 감량 잘 되는 날의 루틴을 기억하세요."</li>`);
            }
        }

        // 62. 뇌피셜 방지 (Fact Check)
        if (AppState.records.length > 30) {
             const r7 = AppState.records.slice(-7);
             const r30 = AppState.records.slice(-30);
             const trend7 = r7[r7.length-1].weight - r7[0].weight;
             const trend30 = r30[r30.length-1].weight - r30[0].weight;

             if (trend7 > 0 && trend30 < -1.0) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">🧠 뇌피셜 방지 (Fact Check):</span> "최근 1주일간 체중이 늘어 살이 안 빠진다고 느끼시죠? 하지만 30일 추세는 여전히 하락장입니다. 일시적 반등에 속지 마세요."</li>`);
             }
        }

        // 63. 명절/연휴 후유증 (Holiday Blues)
        const today = new Date();
        const mmdd = DateUtil.format(today).substring(5);
        if (['01-02','01-03','01-04', '09-15', '09-16', '12-26'].includes(mmdd)) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🎁 명절/연휴 후유증:</span> "연휴 급찐살은 지방이 아니라 글리코겐과 수분입니다. 2주 내에 관리하면 100% 복구됩니다. 골든타임을 놓치지 마세요."</li>`);
        }

        // 66. 작용 반작용 (Newton's 3rd Law)
        if (s.maxDrop > 1.5 && s.lastRec.weight - AppState.records[AppState.records.length-2].weight > 0.5) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🍏 작용 반작용:</span> "최근 급격한 감량에 대한 반발력으로 일시적 증량이 왔습니다. 몸이 항상성을 유지하려는 자연스러운 현상입니다."</li>`);
        }

        // 67. 100일의 기적 (100 Days)
        const startD = DateUtil.parse(AppState.records[0].date);
        const lastD = DateUtil.parse(s.lastRec.date);
        const diffDays = DateUtil.daysBetween(startD, lastD);
        if (diffDays >= 95 && diffDays <= 105) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">💯 100일의 기적:</span> "다이어트를 시작한 지 100일이 되었습니다! 습관이 형성되기에 충분한 시간입니다. 이제 다이어트는 당신의 일상입니다."</li>`);
        }

        // 68. 계절성 패턴 (Seasonality - Summer Prep)
        const m = new Date().getMonth() + 1;
        if (m === 5 || m === 6) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">👙 여름 준비 기간:</span> "여름이 다가오고 있습니다. 통계적으로 이 시기에 동기부여가 가장 높습니다. 지금 스퍼트를 올리세요!"</li>`);
        } else if (m === 12 || m === 1) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">❄️ 겨울잠 본능:</span> "기온이 떨어지면 몸은 지방을 축적하려 합니다. 식욕이 느는 것은 본능이니 자책하지 말고 활동량을 늘리세요."</li>`);
        }

        // 69. 목표 달성 압박감 (Goal Anxiety)
        if (s.current - AppState.settings.goal1 < 1.0 && s.current > AppState.settings.goal1) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">😫 목표 달성 압박감:</span> "목표까지 딱 1kg 남았습니다! 이 구간이 가장 안 빠지고 심리적으로 힘든 '마의 구간'입니다. 체중계보다 눈바디를 믿으세요."</li>`);
        }

        // 70. 로또 당첨 확률 (Fun)
        if (s.diffs && s.diffs.length > 0) {
            const sameWeightCount = s.diffs.filter(d => d === 0).length;
            if (sameWeightCount > 5) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">🎰 도플갱어:</span> "소수점까지 체중이 똑같은 날이 <strong>${sameWeightCount}일</strong>이나 됩니다."</li>`);
            }
        }

        // 73. 1% 클럽 (Top 1%)
        if (s.totalLost / AppState.settings.startWeight > 0.2) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">👑 상위 1% 클럽:</span> "체중의 20% 이상을 감량하셨군요! 이는 의학적으로도 놀라운 성과이며, 일반인 중 상위 1%에 해당하는 의지력입니다."</li>`);
        }

        // 75. 우상향 정기예금 (Savings Account)
        if (s.stdDev < 0.2 && totalLost > 2) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🏦 정기예금 패턴:</span> "체중이 정말 꾸준하고 안정적으로 빠지고 있습니다. 가장 이상적이고 요요가 적은 '정석 다이어트'의 표본입니다."</li>`);
        }

        // 76. 수분 컷팅 (Water Cut)
        if (s.lastRec.weight - AppState.records[AppState.records.length-2].weight < -1.5) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">💦 수분 컷팅:</span> "하루 만에 급격히 빠진 것은 지방이 아니라 수분일 가능성이 큽니다. 어제 저염식을 하셨거나 땀을 많이 흘리셨나요?"</li>`);
        }

        // 78. 다이어트 정체성 (Identity)
        const bmiCat = s.bmi < 23 ? '유지어터' : '다이어터';
        if (bmiCat === '유지어터' && totalLost > 5) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🎓 졸업반:</span> "이제 '다이어터'가 아니라 '유지어터'의 영역에 들어섰습니다. 빼는 것보다 지키는 것이 더 어렵습니다."</li>`);
        }


		// 79. 과속 방지턱 (Speed Bump) - 의학적 정밀 버전 (줄바꿈 없음)
        if (s.rate7 && parseFloat(s.rate7) <= -200) { 
             const currentGrams = parseFloat(s.rate7); 
             const absGPerDay = Math.abs(currentGrams);
             const kgPerWeek = (absGPerDay * 7 / 1000).toFixed(2); 

             htmlLines.push(`<li class="insight-item text-danger">
                <span class="insight-label">🚧 과속 방지턱:</span> 
                "현재 감량 속도(<strong>주당 ${kgPerWeek}kg</strong>)가 과도하게 빠릅니다. 담석증 예방을 위한 <strong>지방(오일, 견과류)</strong>과 탈모 방지를 위한 <strong>단백질</strong> 섭취를 지금 즉시 늘리시고, 만약 <strong>오른쪽 윗배 통증, 발열, 황달</strong>이 발생하면 즉시 병원에 가셔서 진료를 받으세요."
             </li>`);
        }
		

        // 80. 버티기 승리 (HODL Victory)
        if (maxPlateau > 10 && s.current < s.lastRec.weight) { 
             htmlLines.push(`<li class="insight-item text-primary"><span class="insight-label">🚀 버티기는 승리한다:</span> "긴 정체기를 뚫고 드디어 하락 추세로 돌아섰습니다! 포기하지 않은 당신의 승리입니다."</li>`);
        }

        // 81. 아홉수 (Ending with 9)
        const lastDigit = Math.floor(s.current) % 10;
        if (lastDigit === 9) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">9️⃣ 아홉수:</span> "앞자리가 바뀌기 직전인 X9kg대입니다. 조금만 더 힘내면 앞자리가 바뀝니다!"</li>`);
        }

        // 82. 데칼코마니 (Decalcomania)
        if (AppState.records.length > 2) {
             const r = AppState.records;
             if (r[r.length-1].weight === r[r.length-2].weight) {
                  htmlLines.push(`<li class="insight-item"><span class="insight-label">🦋 데칼코마니:</span> "어제와 체중이 소수점까지 똑같습니다. 몸이 현재 체중에 적응 중인 것 같습니다."</li>`);
             }
        }

        // 83. 손실 회피 성향 (Loss Aversion)
        if (remaining > 0 && remaining < 2) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">💎 손실 회피:</span> "목표가 코앞입니다. 지금 포기하면 지금까지의 노력이 너무 아깝지 않나요? 딱 3일만 더 버텨봅시다."</li>`);
        }

        // 85. 럭키 세븐 (Lucky 7)
        if (s.current.toString().indexOf('77') > -1) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🎰 잭팟 (77):</span> "체중에 행운의 숫자 77이 들어있습니다. 오늘은 운 좋은 하루가 될 거예요!"</li>`);
        }

        DomUtil.setSafeHtml(AppState.getEl('advancedAnalysisList'), htmlLines.join(''));
    }

    function renderPlateauHelper(s) {
        const phEl = AppState.getEl('plateauHelperText');
        if (!phEl) return;
        const recent = AppState.records.slice(-14); 
        if (recent.length < 7) {
            phEl.innerText = CONFIG.MESSAGES.PLATEAU.NEED_DATA;
            return;
        }
        
        const weights = recent.map(r => r.weight);
        const max = Math.max(...weights);
        const min = Math.min(...weights);
        const diff = MathUtil.diff(max, min);
        
        let msg = "";
        if (diff < 0.5) {
            const tips = CONFIG.MESSAGES.TIPS;
            const tip = tips[Math.floor(Math.random() * tips.length)];
            msg = CONFIG.MESSAGES.PLATEAU.DETECTED.replace('{diff}', diff.toFixed(1)).replace('{tip}', tip);
        } else {
            const lastW = weights[weights.length-1];
            const firstW = weights[0];
            if (lastW < firstW) msg = CONFIG.MESSAGES.PLATEAU.GOOD;
            else msg = CONFIG.MESSAGES.PLATEAU.WARN;
        }
        DomUtil.setSafeHtml(phEl, msg);
    }

    function renderPeriodComparison() {
        const table = AppState.getEl('periodCompareTable');
        if (!table) return;
        const now = new Date();
        const threeMonthsAgo = DateUtil.addMonthsClamped(now, -3);
        const oneYearAgo = DateUtil.addYearsClamped(now, -1);
        
        const getStats = (startDate, endDate) => {
            const recs = AppState.records.filter(r => {
                const d = DateUtil.parse(r.date);
                return d >= startDate && d <= endDate;
            });
            if (recs.length < 2) return null;
            const avgW = recs.reduce((a,b) => a+b.weight, 0) / recs.length;
            const loss = MathUtil.diff(recs[0].weight, recs[recs.length-1].weight);
            const days = DateUtil.daysBetween(DateUtil.parse(recs[0].date), DateUtil.parse(recs[recs.length-1].date)) || 1;
            const speed = loss / days * 7; 
            return { avgW, loss, speed };
        };

        const currentStats = getStats(threeMonthsAgo, now);
        const pastStats = getStats(DateUtil.addMonthsClamped(oneYearAgo, -3), oneYearAgo);

        let rows = [];
        if (currentStats) {
            rows.push(`<tr><td>최근 3개월</td><td>${currentStats.avgW.toFixed(1)}</td><td>${currentStats.loss.toFixed(1)}</td><td>${currentStats.speed.toFixed(2)} kg/주</td></tr>`);
        } else {
            rows.push(`<tr><td>최근 3개월</td><td colspan="3">데이터 부족</td></tr>`);
        }
        
        if (pastStats) {
            rows.push(`<tr><td>작년 동기</td><td>${pastStats.avgW.toFixed(1)}</td><td>${pastStats.loss.toFixed(1)}</td><td>${pastStats.speed.toFixed(2)} kg/주</td></tr>`);
        } else {
             rows.push(`<tr><td>작년 동기</td><td colspan="3">데이터 없음</td></tr>`);
        }
        table.innerHTML = rows.join('');
    }

    function renderDetailedStats(s) {
        const table = AppState.getEl('detailedStatsTable');
        if (!table) return;
        if (AppState.records.length < 2) {
            table.innerHTML = "<tr><td colspan='2'>데이터 부족</td></tr>";
            return;
        }
        
        let rows = [];
        rows.push(`<tr><td>최고 체중 기록일</td><td>${s.maxDate} (${s.max}kg)</td></tr>`);
        rows.push(`<tr><td>최저 체중 기록일</td><td>${s.minDate} (${s.min}kg)</td></tr>`);
        rows.push(`<tr><td>체중 표준 편차</td><td>${s.stdDev.toFixed(2)}</td></tr>`);
        rows.push(`<tr><td>체지방량 변화</td><td>${s.fatChange ? s.fatChange.toFixed(1) + 'kg' : '-'}</td></tr>`);
        rows.push(`<tr><td>제지방량 변화</td><td>${s.lbmChange ? s.lbmChange.toFixed(1) + 'kg' : '-'}</td></tr>`);
        rows.push(`<tr><td>최대 일일 감량</td><td>${s.maxDrop}kg</td></tr>`);
        rows.push(`<tr><td>최대 일일 증량</td><td>${s.maxGain}kg</td></tr>`);
        rows.push(`<tr><td>최장 정체기</td><td>${s.maxPlateau}일</td></tr>`);
        
        table.innerHTML = rows.join('');
    }
    
    function renderExtendedStats() {
        if(AppState.records.length < 2) return;

        const winStats = [0,0,0,0,0,0,0]; 
        const totalStats = [0,0,0,0,0,0,0]; 
        const dayNames = ['일','월','화','수','목','금','토'];
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date).getDay();
            if(AppState.records[i].weight < AppState.records[i-1].weight) winStats[d]++;
            totalStats[d]++;
        }
        let winRows = [];
        dayNames.forEach((name, i) => {
            const rate = totalStats[i] > 0 ? (winStats[i] / totalStats[i] * 100).toFixed(0) : 0;
            winRows.push(`<tr><td>${name}</td><td>${rate}% (${winStats[i]}/${totalStats[i]})</td></tr>`);
        });
        AppState.getEl('dailyWinRateTable').innerHTML = winRows.join('');

        const zones10 = {};
        AppState.records.forEach(r => {
            const z = Math.floor(r.weight / 10) * 10;
            const key = `${z}kg대`;
            if(!zones10[key]) zones10[key] = 0;
            zones10[key]++;
        });
        let zoneRows = [];
        Object.keys(zones10).sort().reverse().forEach(z => {
            zoneRows.push(`<tr><td>${z}</td><td>${zones10[z]}일</td></tr>`);
        });
        AppState.getEl('zoneDurationTable').innerHTML = zoneRows.join('');

        let maxLossStreak = 0, currLossStreak = 0;
        let maxGainStreak = 0, currGainStreak = 0;
        const maxRecStreak = getLongestConsecutiveRecordRun(AppState.records);
        let maxGap = 0;

        for(let i=1; i<AppState.records.length; i++) {
            const diff = AppState.records[i].weight - AppState.records[i-1].weight;
            const dayDiff = DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date));
            
            if(dayDiff !== 1) {
                currLossStreak = 0;
                currGainStreak = 0;
                if(dayDiff > maxGap) maxGap = dayDiff;
                continue;
            }

            if(diff < 0) {
                currLossStreak++; currGainStreak = 0;
                if(currLossStreak > maxLossStreak) maxLossStreak = currLossStreak;
            } else if(diff > 0) {
                currGainStreak++; currLossStreak = 0;
                if(currGainStreak > maxGainStreak) maxGainStreak = currGainStreak;
            } else {
                currLossStreak = 0; currGainStreak = 0;
            }
        }
        let streakHtml = `
            <tr><td>최장 연속 감량</td><td>${maxLossStreak}일</td></tr>
            <tr><td>최장 연속 증량</td><td>${maxGainStreak}일</td></tr>
            <tr><td>최장 연속 기록</td><td>${maxRecStreak}일</td></tr>
            <tr><td>최장 미기록(공백)</td><td>${maxGap}일</td></tr>
        `;
        AppState.getEl('streakDetailTable').innerHTML = streakHtml;

        const monthDiffs = {};
        for(let i=1; i<AppState.records.length; i++) {
            const key = AppState.records[i].date.substring(0, 7);
            const diff = AppState.records[i].weight - AppState.records[i-1].weight;
            if(!monthDiffs[key]) monthDiffs[key] = 0;
            monthDiffs[key] += diff;
        }
        const sortedMonths = Object.keys(monthDiffs).map(k => ({ m: k, v: monthDiffs[k] })).sort((a,b) => a.v - b.v);
        const best3 = sortedMonths.slice(0, 3);
        const worst3 = sortedMonths.slice().reverse().slice(0, 3);
        
        let bwRows = [];
        for(let i=0; i<3; i++) {
            const best = best3[i];
            const worst = worst3[i];
            bwRows.push(`<tr>
                <td>${i+1}위</td>
                <td>${best ? best.m + ' (' + best.v.toFixed(1) + 'kg)' : '-'}</td>
                <td>${worst ? worst.m + ' (+' + worst.v.toFixed(1) + 'kg)' : '-'}</td>
            </tr>`);
        }
        AppState.getEl('bestWorstMonthTable').innerHTML = bwRows.join('');

        // --- [NEW] v3.0.71 The Wall (Zone) Analysis ---
        const zoneDays = {};
        for(let i=0; i<AppState.records.length; i++) {
            const z = Math.floor(AppState.records[i].weight);
            const key = `${z}kg대`;
            if(!zoneDays[key]) zoneDays[key] = 0;
            zoneDays[key]++;
        }
        const sortedZones = Object.keys(zoneDays).map(k => ({ z: k, d: zoneDays[k] })).sort((a,b) => b.d - a.d).slice(0, 3);
        let wallRows = [];
        sortedZones.forEach((z, i) => {
             wallRows.push(`<tr><td>${i+1}위</td><td>${z.z}</td><td>${z.d}일</td></tr>`);
        });
        const wallTbody = AppState.getEl('wallTableBody');
        if(wallTbody) wallTbody.innerHTML = wallRows.length ? wallRows.join('') : '<tr><td colspan="3">분석 중...</td></tr>';

        // --- [NEW] v3.0.71 Monthly Fat Loss ---
        const mFat = {};
        AppState.records.forEach(r => {
            if(!r.fat) return;
            const k = r.date.substring(0, 7);
            if(!mFat[k]) mFat[k] = { startFat: null, endFat: null, startLbm: null, endLbm: null };
            const fatKg = r.weight * (r.fat/100);
            const lbmKg = r.weight - fatKg;
            if(mFat[k].startFat === null) { mFat[k].startFat = fatKg; mFat[k].startLbm = lbmKg; }
            mFat[k].endFat = fatKg; mFat[k].endLbm = lbmKg;
        });
        let fatRows = [];
        Object.keys(mFat).sort().reverse().forEach(k => {
             const d = mFat[k];
             if(d.startFat !== null && d.endFat !== null) {
                 const fatLoss = d.startFat - d.endFat;
                 const lbmChange = d.endLbm - d.startLbm;
                 fatRows.push(`<tr><td>${k}</td><td>${fatLoss.toFixed(1)}kg</td><td>${lbmChange>0?'+':''}${lbmChange.toFixed(1)}kg</td></tr>`);
             }
        });
        const mfBody = AppState.getEl('monthlyFatLossTableBody');
        if(mfBody) mfBody.innerHTML = fatRows.length ? fatRows.join('') : '<tr><td colspan="3">체지방 데이터 부족</td></tr>';
    }
	
    function updateProgressBar(current, lost, percent, remaining) {
        let visualPercent = percent;
        if(visualPercent < 0) visualPercent = 0;
        if(visualPercent > 100) visualPercent = 100;

        AppState.getEl('labelStart').innerText = `시작: ${AppState.settings.startWeight}kg`;
        AppState.getEl('labelGoal').innerText = `목표: ${AppState.settings.goal1}kg`;

        const fill = AppState.getEl('progressBarFill');
        const emoji = AppState.getEl('progressEmoji');
        const text = AppState.getEl('progressText');

        fill.style.width = `${visualPercent}%`;
        emoji.style.right = `${visualPercent}%`;
        text.style.right = `${visualPercent}%`;

        const displayLost = Math.abs(lost).toFixed(1);
        const displayPercent = percent.toFixed(1);
        const safeRemain = remaining > 0 ? remaining : 0;
        
        let remainPercentVal = 100 - percent;
        if (safeRemain <= 0) remainPercentVal = 0;
        const displayRemainPercent = remainPercentVal.toFixed(1);

        let statusMsg = "";
        if (remaining <= 0) statusMsg = "🎉 목표 달성!";

        text.innerHTML = `
            <strong>${current.toFixed(1)}kg</strong> ${statusMsg}<br>
            감량: ${displayLost}kg (${displayPercent}%)<br>
            남은: ${safeRemain}kg (${displayRemainPercent}%)
        `;
    }

    function bmiToPct(value, minScale = 10, maxScale = 35) {
        const pct = ((value - minScale) / (maxScale - minScale)) * 100;
        return MathUtil.clamp(pct, 0, 100);
    }

    function renderBmiStageScale(currentBmi, minScale = 10, maxScale = 35) {
        const scaleEl = AppState.getEl('bmiStageScale');
        if (!scaleEl) return;

        const boundaries = [
            { value: minScale, label: '저체중' },
            { value: CONFIG.BMI.UNDER, label: '정상' },
            { value: CONFIG.BMI.NORMAL_END, label: '과체중' },
            { value: CONFIG.BMI.PRE_OBESE_END, label: '1단계 비만' },
            { value: CONFIG.BMI.OBESE_1_END, label: '2단계 비만' },
            { value: maxScale, label: '' }
        ];

        const clampedCurrent = MathUtil.clamp(currentBmi, minScale, maxScale);
        let html = '';

        for (let i = 1; i < boundaries.length; i++) {
            const tickPos = bmiToPct(boundaries[i].value, minScale, maxScale);
            html += `<span class="bmi-stage-tick" style="left:${tickPos}%"></span>`;
        }

        for (let i = 0; i < boundaries.length - 1; i++) {
            const start = boundaries[i].value;
            const end = boundaries[i + 1].value;
            const mid = (start + end) / 2;
            const pos = bmiToPct(mid, minScale, maxScale);
            const isLastRange = i === boundaries.length - 2;
            const isActive = clampedCurrent >= start && (isLastRange ? clampedCurrent <= end : clampedCurrent < end);
            html += `<span class="bmi-stage-label${isActive ? ' active' : ''}" style="left:${pos}%">${boundaries[i].label}</span>`;
        }

        scaleEl.innerHTML = html;
    }

    function updateBmiProgressBar(bmi, label) {
        const minScale = 10;
        const maxScale = 35;

        const visualPercent = bmiToPct(bmi, minScale, maxScale);
        const rightPos = 100 - visualPercent;

        const fill = AppState.getEl('bmiProgressBarFill');
        if (!fill) return;

        AppState.getEl('bmiLabelLeft').innerText = `BMI ${minScale}`;
        AppState.getEl('bmiLabelRight').innerText = `BMI ${maxScale}`;

        fill.style.width = `${visualPercent}%`;
        AppState.getEl('bmiProgressEmoji').style.right = `${rightPos}%`;
        AppState.getEl('bmiProgressText').style.right = `${rightPos}%`;

        AppState.getEl('bmiProgressText').innerHTML = `
            <strong>BMI ${bmi.toFixed(2)}</strong><br>
            ${label}
        `;

        renderBmiStageScale(bmi, minScale, maxScale);
    }


    // --- 8.5 의학 근거 기반 A4 20페이지 서술형 현재 상태 분석 ---
    function getBmiInfo(bmi) {
        if (!isFinite(bmi) || bmi <= 0) {
            return { label: '데이터 부족', range: '-', grade: 'unknown', description: '키와 체중 기록이 있어야 BMI 해석이 가능합니다.' };
        }
        if (bmi < CONFIG.BMI.UNDER) {
            return { label: '저체중', range: '<18.5', grade: 'danger', description: '감량보다 영양 상태와 체중 회복 필요성을 먼저 평가해야 하는 범위입니다.' };
        }
        if (bmi < CONFIG.BMI.NORMAL_END) {
            return { label: '정상 범위', range: '18.5~22.9', grade: 'good', description: '한국 성인 기준 정상 BMI 범위입니다. 체중 숫자보다 체성분과 유지 가능성이 더 중요해집니다.' };
        }
        if (bmi < CONFIG.BMI.PRE_OBESE_END) {
            return { label: '비만 전 단계', range: '23.0~24.9', grade: 'caution', description: '한국 성인에서 대사 위험이 증가하기 시작하는 구간으로 해석합니다.' };
        }
        if (bmi < CONFIG.BMI.OBESE_1_END) {
            return { label: '1단계 비만', range: '25.0~29.9', grade: 'caution', description: '한국 성인 비만 기준에 해당합니다. 허리둘레, 혈압, 혈당, 지질 등 동반 위험 평가가 중요합니다.' };
        }
        if (bmi < CONFIG.BMI.OBESE_2_END) {
            return { label: '2단계 비만', range: '30.0~34.9', grade: 'danger', description: '비만 관련 동반질환 평가와 전문적인 체중 관리 계획을 고려해야 하는 범위입니다.' };
        }
        return { label: '3단계 비만', range: '≥35.0', grade: 'danger', description: '비만 관련 합병증 위험 평가와 의료진 상담이 특히 중요한 범위입니다.' };
    }

    function formatNumber(value, decimals = 1, fallback = '-') {
        return (typeof value === 'number' && isFinite(value)) ? value.toFixed(decimals) : fallback;
    }

    function formatKg(value, decimals = 1) {
        return (typeof value === 'number' && isFinite(value)) ? `${value.toFixed(decimals)}kg` : '-';
    }

    function formatSignedKg(value, decimals = 1) {
        if (typeof value !== 'number' || !isFinite(value)) return '-';
        return `${value > 0 ? '+' : ''}${value.toFixed(decimals)}kg`;
    }

    function formatPercent(value, decimals = 1) {
        return (typeof value === 'number' && isFinite(value)) ? `${value.toFixed(decimals)}%` : '-';
    }

    function formatSignedPercent(value, decimals = 1) {
        if (typeof value !== 'number' || !isFinite(value)) return '-';
        return `${value > 0 ? '+' : ''}${value.toFixed(decimals)}%`;
    }

    function rateToText(weeklyKg) {
        if (typeof weeklyKg !== 'number' || !isFinite(weeklyKg)) return '데이터 부족';
        if (weeklyKg < -0.05) return `${Math.abs(weeklyKg).toFixed(2)}kg/주 감량`;
        if (weeklyKg > 0.05) return `${weeklyKg.toFixed(2)}kg/주 증량`;
        return '거의 유지';
    }

    function getRecentRecordsByDays(days) {
        if (AppState.records.length === 0) return [];

        // "최근 N일"은 마지막 기록일이 아니라 실제 오늘을 기준으로 계산해야 합니다.
        // 기록이 오래 중단된 상태에서 과거 기록을 현재 추세로 오인해 감량 속도나
        // 목표일 예측에 사용하는 것을 막습니다. N일 구간은 오늘을 포함하므로 N-1일 전부터입니다.
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const safeDays = Math.max(1, Math.floor(Number(days) || 1));
        const cutoff = new Date(today);
        cutoff.setDate(cutoff.getDate() - (safeDays - 1));

        return AppState.records.filter(r => {
            const recordDate = DateUtil.parse(r.date);
            return recordDate >= cutoff && recordDate <= today;
        });
    }

    function calcWindowMetric(days) {
        const rel = getRecentRecordsByDays(days);
        if (rel.length < 2) return null;
        const first = rel[0];
        const last = rel[rel.length - 1];
        const actualDays = Math.max(1, DateUtil.daysBetween(DateUtil.parse(first.date), DateUtil.parse(last.date)));
        const changeKg = MathUtil.diff(last.weight, first.weight);
        const weeklyKg = changeKg / actualDays * 7;
        const percentWeekly = first.weight ? (weeklyKg / first.weight) * 100 : 0;
        return { days, actualDays, count: rel.length, first, last, changeKg, weeklyKg, percentWeekly };
    }

    function calcLinearTrend(records) {
        if (!records || records.length < 2) return null;
        const firstDate = DateUtil.parse(records[0].date);
        const xs = records.map(r => DateUtil.daysBetween(firstDate, DateUtil.parse(r.date)));
        const ys = records.map(r => r.weight);
        const meanX = MathUtil.mean(xs);
        const meanY = MathUtil.mean(ys);
        let numerator = 0, denominator = 0;
        xs.forEach((x, i) => {
            numerator += (x - meanX) * (ys[i] - meanY);
            denominator += Math.pow(x - meanX, 2);
        });
        if (denominator === 0) return null;
        const slope = numerator / denominator;
        const intercept = meanY - slope * meanX;
        let ssTot = 0, ssRes = 0;
        ys.forEach((y, i) => {
            const fitted = intercept + slope * xs[i];
            ssTot += Math.pow(y - meanY, 2);
            ssRes += Math.pow(y - fitted, 2);
        });
        const r2 = ssTot > 0 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;
        return { slopeKgPerDay: slope, weeklyKg: slope * 7, r2, count: records.length };
    }

    function calcRecordingQuality() {
        if (AppState.records.length === 0) return null;
        const firstDate = DateUtil.parse(AppState.records[0].date);
        const lastDate = DateUtil.parse(AppState.records[AppState.records.length - 1].date);
        const spanDays = Math.max(1, Math.round(DateUtil.daysBetween(firstDate, lastDate)) + 1);
        const uniqueDates = new Set(AppState.records.map(r => r.date));
        const fullAdherence = Math.min(100, uniqueDates.size / spanDays * 100);

        // 최근 30일 성실도 역시 마지막 기록일이 아닌 오늘을 기준으로 계산합니다.
        // 그렇지 않으면 수개월 전 기록을 마지막으로 중단한 사용자도 최근 성실도가
        // 높게 표시되어 현재 기록 상태를 잘못 전달할 수 있습니다.
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const cutoff30 = new Date(today);
        cutoff30.setDate(cutoff30.getDate() - 29);
        const recent30Records = AppState.records.filter(r => {
            const recordDate = DateUtil.parse(r.date);
            return recordDate >= cutoff30 && recordDate <= today;
        });
        const observedSpanThroughToday = Math.max(1, Math.round(DateUtil.daysBetween(firstDate, today)) + 1);
        const recentSpan = Math.min(30, observedSpanThroughToday);
        const recentAdherence = Math.min(100, new Set(recent30Records.map(r => r.date)).size / recentSpan * 100);
        const gaps = [];
        for (let i = 1; i < AppState.records.length; i++) {
            gaps.push(DateUtil.daysBetween(DateUtil.parse(AppState.records[i - 1].date), DateUtil.parse(AppState.records[i].date)));
        }
        const maxGap = gaps.length ? Math.max(...gaps) : 0;
        const avgGap = gaps.length ? MathUtil.mean(gaps) : 0;
        let quality = '보통';
        if (recentAdherence >= 80) quality = '매우 좋음';
        else if (recentAdherence >= 55) quality = '좋음';
        else if (recentAdherence < 35) quality = '낮음';
        return { spanDays, totalRecords: AppState.records.length, fullAdherence, recentAdherence, maxGap, avgGap, quality };
    }

    function calcVolatility() {
        const diffs = [];
        for (let i = 1; i < AppState.records.length; i++) {
            // 며칠~수개월 떨어진 두 기록의 차이를 하루 변동으로 계산하면 변동성,
            // 급등락 횟수와 안전 경고가 크게 왜곡됩니다. 실제 연속 날짜만 일간 변화로 사용합니다.
            if (!isNextCalendarDay(AppState.records[i - 1], AppState.records[i])) continue;
            diffs.push(AppState.records[i].weight - AppState.records[i - 1].weight);
        }
        if (diffs.length === 0) {
            return { meanAbsDiff: 0, diffStd: 0, spikeCount: 0, largestGain: 0, largestDrop: 0, status: '데이터 부족' };
        }
        const absDiffs = diffs.map(v => Math.abs(v));
        const meanAbsDiff = MathUtil.mean(absDiffs);
        const diffStd = MathUtil.stdDev(diffs);
        const spikeCount = diffs.filter(v => Math.abs(v) >= 0.7).length;
        const largestGain = Math.max(0, ...diffs);
        const largestDrop = Math.min(0, ...diffs);
        let status = '안정적';
        if (meanAbsDiff >= 0.6 || diffStd >= 0.7) status = '변동 큼';
        else if (meanAbsDiff >= 0.35 || diffStd >= 0.45) status = '중간 변동';
        return { meanAbsDiff, diffStd, spikeCount, largestGain, largestDrop, status };
    }

    function calcPlateauStatus() {
        if (AppState.records.length < 2) return { current: 0, longest: 0, label: '데이터 부족' };
        let current = 0;
        for (let i = AppState.records.length - 1; i > 0; i--) {
            const diff = Math.abs(AppState.records[i].weight - AppState.records[i - 1].weight);
            if (isNextCalendarDay(AppState.records[i - 1], AppState.records[i]) && diff < 0.2) current++;
            else break;
        }
        let longest = 0, run = 0;
        for (let i = 1; i < AppState.records.length; i++) {
            const diff = Math.abs(AppState.records[i].weight - AppState.records[i - 1].weight);
            if (isNextCalendarDay(AppState.records[i - 1], AppState.records[i]) && diff < 0.2) run++;
            else run = 0;
            longest = Math.max(longest, run);
        }
        let label = '정체 아님';
        if (current >= 14) label = '장기 정체 가능성';
        else if (current >= 7) label = '정체기 관찰';
        else if (current >= 3) label = '짧은 유지 구간';
        return { current, longest, label };
    }

    function calcWeekdayPattern() {
        const names = ['일', '월', '화', '수', '목', '금', '토'];
        const sum = Array(7).fill(0);
        const total = Array(7).fill(0);
        const loss = Array(7).fill(0);
        for (let i = 1; i < AppState.records.length; i++) {
            // 요일별 "하루 변화"는 바로 전날 기록이 있을 때만 계산합니다.
            // 기록 공백 전체의 체중 변화를 다음 기록의 요일 하나에 귀속하지 않습니다.
            if (!isNextCalendarDay(AppState.records[i - 1], AppState.records[i])) continue;
            const day = DateUtil.parse(AppState.records[i].date).getDay();
            const diff = AppState.records[i].weight - AppState.records[i - 1].weight;
            sum[day] += diff;
            total[day]++;
            if (diff < 0) loss[day]++;
        }
        const rows = names.map((name, i) => {
            const avg = total[i] ? sum[i] / total[i] : null;
            const winRate = total[i] ? loss[i] / total[i] * 100 : null;
            return { name, index: i, avg, winRate, total: total[i] };
        }).filter(r => r.total > 0);
        const best = rows.length ? [...rows].sort((a, b) => a.avg - b.avg)[0] : null;
        const worst = rows.length ? [...rows].sort((a, b) => b.avg - a.avg)[0] : null;
        const weekendRows = rows.filter(r => r.index === 0 || r.index === 6);
        const weekdayRows = rows.filter(r => r.index >= 1 && r.index <= 5);
        const weekendAvg = weekendRows.length ? MathUtil.mean(weekendRows.map(r => r.avg)) : null;
        const weekdayAvg = weekdayRows.length ? MathUtil.mean(weekdayRows.map(r => r.avg)) : null;
        return { rows, best, worst, weekendAvg, weekdayAvg };
    }

    function calcBodyCompositionContext() {
        const fatRecords = AppState.records.filter(r => typeof r.fat === 'number' && isFinite(r.fat));
        if (fatRecords.length < 2) {
            return { hasData: false, fatRecordCount: fatRecords.length };
        }
        const first = fatRecords[0];
        const last = fatRecords[fatRecords.length - 1];
        const startFatKg = first.weight * (first.fat / 100);
        const endFatKg = last.weight * (last.fat / 100);
        const startLeanKg = first.weight - startFatKg;
        const endLeanKg = last.weight - endFatKg;
        const fatChange = endFatKg - startFatKg;
        const leanChange = endLeanKg - startLeanKg;
        const weightChange = last.weight - first.weight;
        const fatLossShare = weightChange < 0 ? Math.max(0, -fatChange) / Math.abs(weightChange) * 100 : null;
        let status = '해석 가능';
        if (weightChange < 0 && leanChange < -Math.abs(weightChange) * 0.35) status = '제지방 감소 주의';
        else if (weightChange < 0 && fatChange < 0 && leanChange >= -Math.abs(weightChange) * 0.2) status = '체성분 흐름 양호';
        return { hasData: true, fatRecordCount: fatRecords.length, first, last, startFatKg, endFatKg, startLeanKg, endLeanKg, fatChange, leanChange, weightChange, fatLossShare, status };
    }

    function calcForecastContext(currentWeight, goalWeight) {
        const recent30 = getRecentRecordsByDays(30);
        const recent90 = getRecentRecordsByDays(90);
        // 현재 목표일 예측에 오래된 전체 기록을 폴백으로 사용하지 않습니다.
        // 최근 90일 안에 최소 4개 기록이 없으면 현재 추세를 뒷받침할 자료가 부족합니다.
        const trend = calcLinearTrend(recent30.length >= 4 ? recent30 : (recent90.length >= 4 ? recent90 : null));
        if (!trend || currentWeight <= goalWeight || trend.slopeKgPerDay >= -0.01) {
            return { available: false, trend };
        }
        const daysToGoal = (currentWeight - goalWeight) / Math.abs(trend.slopeKgPerDay);
        const lastDate = DateUtil.parse(AppState.records[AppState.records.length - 1].date);
        const eta = new Date(lastDate);
        eta.setDate(eta.getDate() + Math.round(daysToGoal));
        let confidence = '낮음';
        if (trend.count >= 20 && trend.r2 >= 0.55) confidence = '보통~높음';
        else if (trend.count >= 10 && trend.r2 >= 0.3) confidence = '보통';
        return { available: true, trend, daysToGoal, eta: DateUtil.format(eta), confidence };
    }

    function calcMedicalNarrativeContext(s) {
        const records = AppState.records;
        const first = records[0];
        const last = records[records.length - 1];
        const current = last.weight;
        const startWeight = AppState.settings.startWeight;
        const goalWeight = AppState.settings.goal1;
        const heightM = AppState.settings.height / 100;
        const bmi = current / (heightM * heightM);
        const bmiInfo = getBmiInfo(bmi);
        const totalChangeFromStart = current - startWeight;
        const totalLost = startWeight - current;
        const percentFromStart = startWeight ? (totalLost / startWeight) * 100 : 0;
        const targetGap = startWeight - goalWeight;
        const progressPct = targetGap ? MathUtil.clamp((startWeight - current) / targetGap * 100, 0, 100) : 0;
        const remaining = Math.max(0, current - goalWeight);
        const firstDate = DateUtil.parse(first.date);
        const lastDate = DateUtil.parse(last.date);
        const spanDays = Math.max(1, Math.round(DateUtil.daysBetween(firstDate, lastDate)) + 1);
        const allTrend = calcLinearTrend(records);
        const m7 = calcWindowMetric(7);
        const m14 = calcWindowMetric(14);
        const m30 = calcWindowMetric(30);
        const m90 = calcWindowMetric(90);
        const quality = calcRecordingQuality();
        const volatility = calcVolatility();
        const plateau = calcPlateauStatus();
        const weekday = calcWeekdayPattern();
        const bodyComp = calcBodyCompositionContext();
        const forecast = calcForecastContext(current, goalWeight);
        const safeWeeklyLow = current * 0.005;
        const safeWeeklyHigh = current * 0.01;
        // "최근 대표 속도"에는 현재 기간 안의 기록만 사용합니다. 전체 과거 추세는
        // 별도 전체 추세 항목으로 유지하되, 장기간 기록 공백이 있으면 현재 속도로 재사용하지 않습니다.
        const activeRate = m30 || m14 || m7 || m90 || null;
        const activeWeeklyKg = activeRate ? activeRate.weeklyKg : 0;
        const activeWeeklyLoss = activeWeeklyKg < 0 ? Math.abs(activeWeeklyKg) : 0;
        let speedStatus = '평가 보류';
        if (activeRate) {
            if (activeWeeklyLoss > safeWeeklyHigh) speedStatus = '빠른 감량';
            else if (activeWeeklyLoss >= safeWeeklyLow && activeWeeklyLoss <= safeWeeklyHigh) speedStatus = '권장 범위에 가까움';
            else if (activeWeeklyKg > 0.15) speedStatus = '최근 증량';
            else speedStatus = '느린 감량 또는 유지';
        }
        const energyDailyDeficit = activeWeeklyKg < 0 ? Math.abs(activeWeeklyKg) / 7 * 7700 : 0;
        const estimatedTdee = energyDailyDeficit > 0 ? (AppState.settings.intake || 0) + energyDailyDeficit : null;
        const flags = [];
        if (records.length < 7) flags.push('기록 수가 7개 미만이라 추세 신뢰도가 낮습니다.');
        if (bmi < CONFIG.BMI.UNDER) flags.push('BMI가 저체중 범위입니다. 감량 목표보다 의학적 평가가 우선입니다.');
        if (activeWeeklyLoss > safeWeeklyHigh && activeWeeklyLoss > 0) flags.push('최근 감량 속도가 현재 체중의 1%/주를 초과합니다. 피로, 어지러움, 폭식 반동, 제지방 감소를 점검해야 합니다.');
        if (bodyComp.hasData && bodyComp.status === '제지방 감소 주의') flags.push('체지방률 기록상 제지방 감소 비중이 커 보입니다. 단백질 섭취와 저항운동 점검이 필요합니다.');
        if (volatility.status === '변동 큼') flags.push('체중 변동성이 큽니다. 나트륨, 수면, 생리주기, 음주, 운동 후 염증·수분 저류 요인을 함께 봐야 합니다.');
        return {
            s, records, first, last, current, startWeight, goalWeight, bmi, bmiInfo,
            totalChangeFromStart, totalLost, percentFromStart, progressPct, remaining,
            spanDays, allTrend, m7, m14, m30, m90, quality, volatility, plateau, weekday, bodyComp,
            forecast, safeWeeklyLow, safeWeeklyHigh, activeRate, activeWeeklyKg, activeWeeklyLoss,
            speedStatus, energyDailyDeficit, estimatedTdee, flags
        };
    }

    function buildMetricHtml(metrics) {
        if (!metrics || metrics.length === 0) return '';
        return `<div class="narrative-metric-grid">${metrics.map(m => `
            <div class="narrative-metric">
                <div class="narrative-metric-label">${DomUtil.escapeHtml(m.label)}</div>
                <div class="narrative-metric-value">${DomUtil.escapeHtml(m.value)}</div>
            </div>`).join('')}</div>`;
    }

    function getEvidenceMap() {
        const map = {};
        CONFIG.MEDICAL_EVIDENCE.forEach(e => { map[e.key] = e; });
        return map;
    }

    function buildEvidenceChips(keys) {
        const map = getEvidenceMap();
        const chips = (keys || []).map(k => map[k]).filter(Boolean).map(e => {
            return `<a class="evidence-chip" href="${DomUtil.escapeHtml(e.url)}" target="_blank" rel="noopener noreferrer">📚 ${DomUtil.escapeHtml(e.label)}</a>`;
        });
        return chips.length ? `<div class="evidence-chip-row">${chips.join('')}</div>` : '';
    }

    function buildPageHtml(page, index, total) {
        const paragraphs = page.paragraphs.map(p => `<p>${DomUtil.escapeHtml(p)}</p>`).join('');
        const callout = page.callout ? `<div class="narrative-callout ${DomUtil.escapeHtml(page.calloutType || '')}">${DomUtil.escapeHtml(page.callout)}</div>` : '';
        const references = page.referencesHtml || '';
        return `<section class="narrative-page">
            <div class="narrative-page-header">
                <h4>${DomUtil.escapeHtml(page.title)}</h4>
                <div class="narrative-page-number">A4 ${index + 1}/${total}</div>
            </div>
            <p class="narrative-lead">${DomUtil.escapeHtml(page.lead)}</p>
            ${buildMetricHtml(page.metrics)}
            ${paragraphs}
            ${callout}
            ${references}
            ${buildEvidenceChips(page.evidence)}
        </section>`;
    }

    function buildPageText(page, index, total) {
        const metricText = page.metrics && page.metrics.length
            ? ['핵심 지표', ...page.metrics.map(m => `- ${m.label}: ${m.value}`), ''].join('\n')
            : '';
        const evidenceMap = getEvidenceMap();
        const evidenceText = page.evidence && page.evidence.length
            ? '\n근거: ' + page.evidence.map(k => evidenceMap[k]).filter(Boolean).map(e => `${e.label}(${e.year})`).join(', ') + '\n'
            : '';
        const refsText = page.referencesText ? '\n' + page.referencesText + '\n' : '';
        return [`[A4 ${index + 1}/${total}] ${page.title}`, page.lead, '', metricText, page.paragraphs.join('\n\n'), page.callout ? `\n주의/해석: ${page.callout}\n` : '', refsText, evidenceText].filter(Boolean).join('\n');
    }

    function buildMedicalNarrativePages(ctx) {
        const recentRateText = ctx.activeRate ? rateToText(ctx.activeRate.weeklyKg) : '데이터 부족';
        const bestDay = ctx.weekday.best ? `${ctx.weekday.best.name}요일(${formatSignedKg(ctx.weekday.best.avg, 2)}/기록)` : '데이터 부족';
        const worstDay = ctx.weekday.worst ? `${ctx.weekday.worst.name}요일(${formatSignedKg(ctx.weekday.worst.avg, 2)}/기록)` : '데이터 부족';
        const bodyCompSummary = ctx.bodyComp.hasData
            ? `체지방량 변화 ${formatSignedKg(ctx.bodyComp.fatChange, 1)}, 제지방량 변화 ${formatSignedKg(ctx.bodyComp.leanChange, 1)}`
            : `체지방률 기록 ${ctx.bodyComp.fatRecordCount}개로 정밀한 체성분 해석은 보류`;
        const forecastText = ctx.forecast.available
            ? `${ctx.forecast.eta} 전후, 약 ${Math.round(ctx.forecast.daysToGoal)}일, 신뢰도 ${ctx.forecast.confidence}`
            : '현재 추세만으로는 목표일 예측 보류';
        const warningText = ctx.flags.length ? ctx.flags.join(' ') : '현재 기록만으로 즉시 중단이 필요한 위험 신호는 뚜렷하지 않습니다. 다만 앱 데이터는 진단이 아니므로 증상이나 기저질환이 있으면 의료진 판단이 우선입니다.';
        const calorieText = ctx.energyDailyDeficit > 0
            ? `최근 추세를 7,700kcal/kg의 단순 환산으로 보면 하루 약 ${Math.round(ctx.energyDailyDeficit)}kcal의 에너지 부족에 해당합니다.`
            : '최근 추세가 유지 또는 증량에 가까워 단순 결손 열량을 산출하지 않았습니다.';
        const estimatedTdeeText = ctx.estimatedTdee ? `섭취 ${AppState.settings.intake || 0}kcal 가정 시 관찰 기반 TDEE는 약 ${Math.round(ctx.estimatedTdee)}kcal로 추정됩니다.` : '감량 추세가 명확하지 않아 관찰 기반 TDEE 추정은 보류합니다.';
        const refsHtml = `<ol class="narrative-reference-list">${CONFIG.MEDICAL_EVIDENCE.map(e => `<li><strong>${DomUtil.escapeHtml(e.label)}</strong> (${DomUtil.escapeHtml(e.year)}). ${DomUtil.escapeHtml(e.title)}. <em>${DomUtil.escapeHtml(e.source)}</em>. <a href="${DomUtil.escapeHtml(e.url)}" target="_blank" rel="noopener noreferrer">원문 보기</a><br>${DomUtil.escapeHtml(e.note)}</li>`).join('')}</ol>`;
        const refsText = '참고문헌\n' + CONFIG.MEDICAL_EVIDENCE.map((e, i) => `${i + 1}. ${e.label} (${e.year}). ${e.title}. ${e.source}. ${e.url} - ${e.note}`).join('\n');
        const trendReliabilityText = ctx.allTrend
            ? (ctx.allTrend.r2 >= 0.55 ? '높음' : (ctx.allTrend.r2 >= 0.30 ? '보통' : '낮음'))
            : '데이터 부족';
        const adherenceActionText = ctx.quality.recentAdherence >= 80
            ? '현재 기록 루틴을 유지하면서 식사·수면·운동 같은 보조 변수를 조금씩 추가하면 좋습니다.'
            : (ctx.quality.recentAdherence >= 55
                ? '기록 누락이 생기는 요일을 줄이는 것이 다음 개선 포인트입니다.'
                : '분석보다 먼저 기록 루틴을 회복하는 것이 우선입니다. 최소 2주 동안 같은 조건의 체중 기록을 다시 쌓으십시오.');
        const plateauActionText = ctx.plateau.current >= 14
            ? '2주 이상 정체 신호가 이어지므로 섭취량 추정, 주말 패턴, 수면, 활동량, 저항운동 수행 저하를 순서대로 재점검해야 합니다.'
            : (ctx.plateau.current >= 7
                ? '1주 이상 유지 구간입니다. 즉시 절식하기보다 7일 평균과 30일 추세를 한 번 더 확인하는 편이 안전합니다.'
                : '현재는 장기 정체보다 일반적인 체중 노이즈 가능성이 더 큽니다.');
        const speedSafetyText = ctx.speedStatus === '빠른 감량'
            ? '현재 속도는 빠른 감량 경고에 해당하므로 에너지 결손을 더 키우기보다 단백질·저항운동·수면·증상 여부를 먼저 확인해야 합니다.'
            : (ctx.speedStatus === '최근 증량'
                ? '최근 증량 신호가 있으므로 단기 수분 변화와 실제 섭취 증가를 구분해 보아야 합니다.'
                : '현재 속도는 극단적인 조정보다 유지 가능한 생활 패턴을 다듬는 접근이 더 적합합니다.');
        const weekendDeltaText = (ctx.weekday.weekendAvg !== null && ctx.weekday.weekdayAvg !== null)
            ? formatSignedKg(ctx.weekday.weekendAvg - ctx.weekday.weekdayAvg, 2)
            : '데이터 부족';
        const maintenanceBandText = ctx.goalWeight
            ? `${formatKg(ctx.goalWeight - 1, 1)}~${formatKg(ctx.goalWeight + 2, 1)}`
            : '목표 체중 설정 필요';
        const weeklyPercentText = ctx.activeRate ? formatPercent(Math.abs(ctx.activeRate.percentWeekly || 0), 2) : '데이터 부족';
        const nextExperimentTarget = ctx.plateau.current >= 7
            ? '정체기 원인 분해'
            : (ctx.quality.recentAdherence < 55
                ? '기록 루틴 회복'
                : (ctx.weekday.worst ? `${ctx.weekday.worst.name}요일 환경 조정` : '가장 반복되는 실패 환경 1개 조정'));
        const dataConfidenceText = `${ctx.quality.quality} 기록 품질 · 추세 신뢰도 ${trendReliabilityText}`;

        return [
            {
                title: '현재 상태 총괄 요약: 체중 숫자보다 추세와 안전성을 함께 보는 해석',
                lead: `현재 마지막 기록은 ${ctx.last.date}의 ${formatKg(ctx.current, 1)}이며, 시작 체중 ${formatKg(ctx.startWeight, 1)} 대비 ${formatSignedKg(ctx.totalChangeFromStart, 1)} 변화했습니다.`,
                metrics: [
                    { label: '현재 체중', value: formatKg(ctx.current, 1) },
                    { label: '시작 대비 변화', value: `${formatSignedKg(ctx.totalChangeFromStart, 1)} (${formatSignedPercent(-ctx.percentFromStart, 1)})` },
                    { label: '목표까지', value: formatKg(ctx.remaining, 1) },
                    { label: '목표 진행률', value: formatPercent(ctx.progressPct, 1) }
                ],
                paragraphs: [
                    `이 리포트는 입력된 체중과 체지방률 기록을 시간순으로 해석하여 현재 상태를 서술형으로 정리합니다. 단순히 오늘 체중이 줄었는지 늘었는지보다, 전체 기록 기간 ${ctx.spanDays}일 동안의 방향성, 최근 7일·14일·30일의 속도, 변동성, 기록 성실도, 체성분 신호, 목표 체중까지의 거리와 안전성을 함께 보도록 설계되어 있습니다.`,
                    `현재까지의 총 변화는 ${ctx.totalLost >= 0 ? '감량' : '증량'} 방향입니다. 시작 체중 대비 체중 변화율은 ${formatPercent(ctx.percentFromStart, 1)}로 계산됩니다. 임상적으로는 체중의 3~5%만 줄어도 혈압, 혈당, 지질 등 일부 대사 지표가 개선될 수 있고, 5~10% 감량은 많은 비만 관리 지침에서 1차 목표로 다루어집니다. 따라서 ${formatPercent(ctx.percentFromStart, 1)}라는 수치는 미용적 평가가 아니라 대사 건강 관점에서도 의미를 가질 수 있는 변화인지 확인하는 출발점입니다.`,
                    `목표 체중 ${formatKg(ctx.goalWeight, 1)}까지 남은 거리는 ${formatKg(ctx.remaining, 1)}입니다. 진행률은 ${formatPercent(ctx.progressPct, 1)}로 표시되지만, 진행률이 높다고 해서 반드시 건강한 감량이라는 뜻은 아닙니다. 너무 빠른 속도, 체지방보다 제지방이 더 많이 줄어드는 흐름, 기록 공백이 많은 데이터는 별도로 경고해야 합니다.`,
                    `현재 앱은 한국 성인 기준 BMI 분류를 적용하고, 최근 속도는 현재 체중의 약 0.5~1.0%/주 범위를 참고 범위로 삼아 해석합니다. 이는 개인의 질환, 약물, 운동량, 수면, 생리주기, 염분 섭취, 측정 시간 차이를 모두 반영한 진단은 아니지만, 기록 기반 자기 점검에는 충분히 유용한 기준점이 됩니다.`,
                    `이번 총괄 결론은 “${ctx.speedStatus}”입니다. 최근 대표 감량 속도는 ${recentRateText}로 계산되며, 현재 체중에서 앱이 보는 참고 속도 범위는 약 ${formatKg(ctx.safeWeeklyLow, 2)}~${formatKg(ctx.safeWeeklyHigh, 2)}/주입니다. 이 범위를 크게 넘으면 단기 수분 변화인지, 실제 열량 결손이 과도한지, 운동 후 염증·글리코겐 변화인지 구분해야 합니다.`
                ],
                callout: warningText,
                calloutType: ctx.flags.length ? 'warning' : 'good',
                evidence: ['KSSO_MGMT_2020', 'KSSO_DIAG_2022', 'USPSTF_BEHAVIOR_2018']
            },
            {
                title: '기록 품질과 자기모니터링 분석: 데이터가 좋아야 해석도 좋아집니다',
                lead: `전체 ${ctx.quality.totalRecords}개 기록, 전체 기록 밀도 ${formatPercent(ctx.quality.fullAdherence, 1)}, 최근 30일 기록 성실도 ${formatPercent(ctx.quality.recentAdherence, 1)}입니다.`,
                metrics: [
                    { label: '기록 기간', value: `${ctx.first.date} ~ ${ctx.last.date}` },
                    { label: '전체 기록 수', value: `${ctx.quality.totalRecords}개` },
                    { label: '최근 30일 성실도', value: formatPercent(ctx.quality.recentAdherence, 1) },
                    { label: '최대 공백', value: `${Math.round(ctx.quality.maxGap)}일` }
                ],
                paragraphs: [
                    `체중 관리는 “완벽한 하루”보다 “관찰 가능한 반복”에서 힘이 생깁니다. 현재 데이터의 기록 품질은 ${ctx.quality.quality}으로 평가됩니다. 최근 30일 성실도 ${formatPercent(ctx.quality.recentAdherence, 1)}는 단기 추세 해석의 신뢰도를 결정하는 핵심 값입니다. 기록 간 평균 간격은 약 ${formatNumber(ctx.quality.avgGap, 1)}일이며, 최대 공백은 ${Math.round(ctx.quality.maxGap)}일입니다.`,
                    `체중은 음식 섭취량, 수분, 염분, 배변, 운동 후 근육 손상, 호르몬 변화의 영향을 받습니다. 그래서 며칠의 숫자만으로 성공과 실패를 판단하면 과잉해석이 생깁니다. 반대로 같은 조건에서 자주 기록하면 노이즈가 평균화되어 추세가 선명해집니다.`,
                    `최근 자기모니터링 연구들은 정기적인 체중 기록이 행동 피드백, 식사 선택, 활동량 조절, 체중 증가의 조기 감지에 도움이 될 수 있음을 보여줍니다. 이 앱의 리포트는 바로 그 장점을 살리기 위해 기록 성실도를 별도 지표로 분리했습니다.`,
                    `가장 좋은 방식은 아침 기상 후 화장실을 다녀온 뒤, 식사 전, 비슷한 복장 또는 동일 조건에서 측정하는 것입니다. 매일 기록하더라도 하루 변화에 감정적으로 반응하기보다 7일 평균과 30일 추세를 기준으로 판단하는 편이 안전합니다.`,
                    `현재 기록 품질이 낮게 나오는 경우, 감량이 되지 않는다는 결론보다 먼저 “데이터가 충분하지 않다”는 결론이 우선입니다. 특히 주말, 외식 다음날, 운동 다음날, 수면 부족 다음날 기록이 빠지면 체중 패턴의 중요한 구간이 사라질 수 있습니다.`
                ],
                callout: `권장 사용법: 최소 주 4회 이상, 가능하면 매일 같은 조건에서 측정하고, 단기 평가는 7일 평균, 전략 평가는 30일 추세로 보십시오.`,
                evidence: ['SELF_MONITOR_2024', 'VUORINEN_2021', 'USPSTF_BEHAVIOR_2018']
            },
            {
                title: 'BMI와 한국 성인 비만 기준 해석: 현재 숫자의 의학적 위치',
                lead: `현재 BMI는 ${formatNumber(ctx.bmi, 2)}이며 한국 성인 기준 ${ctx.bmiInfo.label} 범위입니다.`,
                metrics: [
                    { label: 'BMI', value: formatNumber(ctx.bmi, 2) },
                    { label: '분류', value: ctx.bmiInfo.label },
                    { label: '기준 구간', value: ctx.bmiInfo.range },
                    { label: 'BMI Prime', value: formatNumber(ctx.bmi / 23, 2) }
                ],
                paragraphs: [
                    `BMI는 체중을 키의 제곱으로 나눈 값입니다. 현재 ${formatNumber(ctx.bmi, 2)}라는 값은 한국 성인 기준으로 ${ctx.bmiInfo.label}에 해당합니다. 한국 기준은 서구권의 BMI 25 과체중, 30 비만 기준과 다르게, 대사 위험 증가가 더 낮은 BMI에서 관찰되는 아시아인 특성을 반영합니다.`,
                    `${ctx.bmiInfo.description} 이 해석은 체중의 “좋고 나쁨”을 평가하는 도덕적 판단이 아니라, 대사 위험을 놓치지 않기 위한 선별 도구입니다.`,
                    `다만 BMI는 지방량과 근육량을 구분하지 못합니다. 근력운동을 많이 하는 사람은 BMI가 높아도 체지방률이 낮을 수 있고, 반대로 BMI가 정상이어도 복부 지방이 많으면 대사 위험이 커질 수 있습니다. 따라서 체지방률, 허리둘레, 혈압, 공복혈당, HbA1c, 지질검사 같은 정보를 함께 볼 때 해석력이 좋아집니다.`,
                    `현재 앱에 허리둘레 입력칸은 없지만, 리포트는 허리둘레 측정의 중요성을 계속 안내합니다. 한국 성인에서는 남성 90cm 이상, 여성 85cm 이상을 복부비만 기준으로 사용합니다. 복부비만은 같은 BMI라도 심혈관·대사 위험을 더 잘 설명할 수 있습니다.`,
                    `따라서 현재 목표 체중은 BMI 숫자만으로 정하지 않는 편이 좋습니다. 목표는 “BMI 정상화”와 함께 “지방 감소, 제지방 보존, 유지 가능한 식사·운동 패턴, 대사 지표 개선”을 동시에 만족해야 합니다.`
                ],
                callout: `BMI가 비만 범위이거나 허리둘레가 기준 이상이라면 체중 기록만으로 끝내지 말고 혈압, 혈당, 지질, 간수치, 수면무호흡 증상 등을 점검하는 것이 안전합니다.`,
                evidence: ['KSSO_DIAG_2022', 'CANADA_CPG_2020', 'WAIST_2020']
            },
            {
                title: '감량 속도와 추세 분석: 최근 변화가 지속 가능한 변화인지 평가',
                lead: `대표 최근 속도는 ${recentRateText}이며, 전체 선형 추세는 ${ctx.allTrend ? rateToText(ctx.allTrend.weeklyKg) : '데이터 부족'}입니다.`,
                metrics: [
                    { label: '최근 7일', value: ctx.m7 ? rateToText(ctx.m7.weeklyKg) : '부족' },
                    { label: '최근 14일', value: ctx.m14 ? rateToText(ctx.m14.weeklyKg) : '부족' },
                    { label: '최근 30일', value: ctx.m30 ? rateToText(ctx.m30.weeklyKg) : '부족' },
                    { label: '속도 판정', value: ctx.speedStatus }
                ],
                paragraphs: [
                    `체중 변화는 하루 단위보다 주 단위로 보아야 합니다. 현재 최근 7일 속도는 ${ctx.m7 ? rateToText(ctx.m7.weeklyKg) : '데이터 부족'}, 최근 14일 속도는 ${ctx.m14 ? rateToText(ctx.m14.weeklyKg) : '데이터 부족'}, 최근 30일 속도는 ${ctx.m30 ? rateToText(ctx.m30.weeklyKg) : '데이터 부족'}입니다.`,
                    `단기 속도가 빠르게 보일 때는 실제 지방 감소와 수분·글리코겐 감소가 섞여 있을 가능성이 큽니다. 반대로 며칠간 체중이 오르더라도 30일 추세가 내려가고 있다면 전략이 실패했다고 단정하기 어렵습니다.`,
                    `현재 체중 기준으로 앱이 참고하는 감량 속도 범위는 ${formatKg(ctx.safeWeeklyLow, 2)}~${formatKg(ctx.safeWeeklyHigh, 2)}/주입니다. 이 범위는 사용자의 현재 체중에 비례하도록 설정되어, 체중이 낮아질수록 과도한 감량 경고가 더 민감해집니다.`,
                    `전체 선형 추세의 설명력은 ${ctx.allTrend ? formatPercent(ctx.allTrend.r2 * 100, 1) : '부족'}입니다. 이 값이 높을수록 체중이 비교적 일정한 방향으로 움직였다는 뜻이고, 낮을수록 체중 변화가 들쭉날쭉해 예측이 어렵다는 뜻입니다.`,
                    `임상적으로 중요한 점은 “빠르게 줄이는 것”이 아니라 “지방을 줄이면서 장기 유지가 가능한가”입니다. 지나치게 빠른 감량은 피로, 운동 수행 저하, 배고픔 증가, 폭식 반동, 제지방 감소, 담석 위험 증가와 연결될 수 있으므로 리포트는 빠른 속도를 무조건 좋은 신호로 해석하지 않습니다.`
                ],
                callout: `현재 속도 판정은 ${ctx.speedStatus}입니다. 최근 30일 이상 데이터가 쌓일수록 이 판정은 더 안정적으로 변합니다.`,
                calloutType: ctx.speedStatus === '빠른 감량' ? 'warning' : '',
                evidence: ['KSSO_MGMT_2020', 'USPSTF_BEHAVIOR_2018', 'CANADA_CPG_2020']
            },
            {
                title: '변동성·수분·정체기 분석: 체중계 노이즈를 실패로 오해하지 않기',
                lead: `평균 일간 변동폭은 ${formatKg(ctx.volatility.meanAbsDiff, 2)}, 변동성 상태는 ${ctx.volatility.status}, 현재 정체 신호는 ${ctx.plateau.label}입니다.`,
                metrics: [
                    { label: '평균 일간 변동', value: formatKg(ctx.volatility.meanAbsDiff, 2) },
                    { label: '최대 증가', value: formatSignedKg(ctx.volatility.largestGain, 1) },
                    { label: '최대 감소', value: formatSignedKg(ctx.volatility.largestDrop, 1) },
                    { label: '현재 정체', value: `${ctx.plateau.current}회 연속` }
                ],
                paragraphs: [
                    `체중계의 하루 변화는 지방만 반영하지 않습니다. 탄수화물 섭취가 늘면 글리코겐과 수분이 함께 저장되고, 짠 음식을 먹으면 수분 저류가 늘 수 있으며, 강한 운동 후에는 근육 염증과 회복 과정 때문에 체중이 일시적으로 오를 수 있습니다.`,
                    `현재 평균 일간 변동폭은 ${formatKg(ctx.volatility.meanAbsDiff, 2)}입니다. 이 값이 커질수록 하루 체중보다 이동평균을 우선해야 합니다. 변동성이 큰 시기에는 “어제보다 늘었다”가 아니라 “7일 평균이 어떻게 움직였는가”를 보아야 합니다.`,
                    `현재 정체기 판정은 ${ctx.plateau.label}입니다. 앱은 인접 기록 간 변화가 0.2kg 미만인 흐름을 정체 관찰 신호로 잡습니다. 다만 정체는 대사 적응만의 결과가 아니라, 기록 공백, 배변·수분 변화, 섭취량 추정 오차, 활동량 감소, 수면 부족이 함께 만든 결과일 수 있습니다.`,
                    `장기 체중 변동성이 높은 사람에서 심혈관 위험이 높게 관찰된 연구들이 있지만, 개인 앱의 단기 변동을 질병 위험으로 직접 해석해서는 안 됩니다. 여기서 변동성 지표는 “전략이 너무 흔들리는지”, “측정 조건이 일정한지”, “수분 요인을 과잉해석하고 있지 않은지”를 점검하는 도구입니다.`,
                    `체중이 정체될 때 가장 먼저 할 일은 극단적 절식이 아니라 기록 품질 확인, 평균 섭취량 재점검, 단백질과 식이섬유 보강, 수면 확보, 주당 운동량과 NEAT 감소 여부 확인입니다. 체중이 줄면서 자연스럽게 에너지 소비량도 줄기 때문에 초기에 통하던 섭취량이 나중에는 유지 칼로리에 가까워질 수 있습니다.`
                ],
                callout: `정체가 2주 이상 지속되고 기록 성실도가 충분하다면, 하루 섭취량·외식 빈도·음주·수면·운동량을 같이 재검토하십시오.`,
                evidence: ['WEIGHT_VARIABILITY_2023', 'SLEEP_EXTENSION_2022', 'KSSO_MGMT_2020']
            },
            {
                title: '체성분과 제지방 보존 분석: 감량의 질을 보는 페이지',
                lead: bodyCompSummary,
                metrics: [
                    { label: '체지방률 기록', value: `${ctx.bodyComp.fatRecordCount || 0}개` },
                    { label: '체지방량 변화', value: ctx.bodyComp.hasData ? formatSignedKg(ctx.bodyComp.fatChange, 1) : '부족' },
                    { label: '제지방량 변화', value: ctx.bodyComp.hasData ? formatSignedKg(ctx.bodyComp.leanChange, 1) : '부족' },
                    { label: '체성분 판정', value: ctx.bodyComp.status || '보류' }
                ],
                paragraphs: [
                    `체중 감량의 질은 “몇 kg 줄었는가”보다 “무엇이 줄었는가”로 평가해야 합니다. 지방량이 줄고 제지방량이 유지되는 흐름은 대사 건강, 운동 수행, 장기 유지 가능성 측면에서 더 바람직합니다.`,
                    ctx.bodyComp.hasData
                        ? `현재 체지방률 기록을 기준으로 첫 체지방 기록(${ctx.bodyComp.first.date})과 마지막 체지방 기록(${ctx.bodyComp.last.date})을 비교하면 체지방량은 ${formatSignedKg(ctx.bodyComp.fatChange, 1)}, 제지방량은 ${formatSignedKg(ctx.bodyComp.leanChange, 1)} 변했습니다. 감량 기간 중 지방 손실 비중 추정치는 ${ctx.bodyComp.fatLossShare === null ? '산출 보류' : formatPercent(ctx.bodyComp.fatLossShare, 1)}입니다.`
                        : `현재 체지방률 기록이 충분하지 않아 지방량과 제지방량 변화를 분리해 해석하기 어렵습니다. 체중은 줄었지만 근육과 수분이 많이 줄었는지, 지방이 주로 줄었는지는 체지방률·허리둘레·운동 수행 변화를 함께 기록해야 더 잘 알 수 있습니다.`,
                    `가정용 체지방률 측정기는 수분 상태, 운동 직후 여부, 측정 시간, 피부 온도 등에 영향을 받습니다. 따라서 체지방률도 하루 수치보다 같은 조건에서의 장기 추세가 더 중요합니다.`,
                    `무작위시험과 여러 임상 연구는 에너지 제한 중 충분한 단백질 섭취와 저항운동이 제지방량 보존에 유리할 수 있음을 보여줍니다. 앱은 특정 식단을 처방하지 않지만, 체성분 페이지에서 제지방 감소 신호가 보이면 단백질, 근력운동, 감량 속도를 함께 점검하도록 설계했습니다.`,
                    `제지방량 감소가 의심될 때는 감량 속도를 늦추고, 근력운동 수행 기록, 단백질 섭취량, 수면, 회복 상태를 우선 확인하는 것이 좋습니다. 특히 피로감, 어지러움, 무월경, 탈모, 폭식 반동, 운동 수행 급감이 동반되면 단순 앱 분석이 아니라 의료진 또는 임상영양사 상담이 필요합니다.`
                ],
                callout: `체성분 해석을 강화하려면 체중과 함께 체지방률 또는 허리둘레를 주 1~3회, 같은 시간대에 기록하십시오.`,
                evidence: ['LONGLAND_2016', 'VERREIJEN_2017', 'WAIST_2020']
            },
            {
                title: '에너지 균형과 섭취량 해석: 칼로리 계산은 방향계이지 진단기가 아닙니다',
                lead: `${calorieText} ${estimatedTdeeText}`,
                metrics: [
                    { label: '입력 섭취량', value: `${AppState.settings.intake || 0}kcal/일` },
                    { label: '관찰 결손 추정', value: ctx.energyDailyDeficit > 0 ? `${Math.round(ctx.energyDailyDeficit)}kcal/일` : '보류' },
                    { label: '관찰 TDEE 추정', value: ctx.estimatedTdee ? `${Math.round(ctx.estimatedTdee)}kcal/일` : '보류' },
                    { label: '최근 대표 속도', value: recentRateText }
                ],
                paragraphs: [
                    `에너지 균형은 체중 변화의 핵심 원리입니다. 그러나 사람의 몸은 단순 계산기처럼 움직이지 않습니다. 체중이 줄면 기초대사량과 활동 에너지 소비가 변하고, 무의식적 활동량이 줄 수 있으며, 수분과 글리코겐 변화가 단기 체중을 크게 흔듭니다.`,
                    `${calorieText} 이 값은 체지방 1kg을 약 7,700kcal로 보는 단순 환산을 이용한 참고값입니다. 실제 지방 조직의 에너지 밀도, 체성분 변화, 수분 변화, 대사 적응 때문에 개인별 실제 값은 달라질 수 있습니다.`,
                    `${estimatedTdeeText} 이 추정치는 사용자가 입력한 평균 섭취량이 실제와 가깝고, 최근 체중 변화가 주로 지방 변화라는 가정에 의존합니다. 외식, 간식, 조리유, 음료, 주말 섭취가 빠지면 추정 TDEE는 왜곡됩니다.`,
                    `비만 관리 지침에서는 대개 식사, 신체활동, 행동전략을 함께 쓰는 다요소 접근을 강조합니다. 단순히 섭취 열량만 낮추면 초기에는 체중이 줄 수 있지만, 배고픔 증가와 활동량 감소로 장기 유지가 어려워질 수 있습니다.`,
                    `이 페이지의 핵심은 “정확한 칼로리 숫자”가 아니라 “현재 전략이 관찰 결과와 맞는가”입니다. 기록한 섭취량 대비 체중이 예상보다 덜 줄면 섭취 누락, 주말 편차, 활동량 감소, 수면 부족, 체중 정체기를 차례로 점검하는 것이 합리적입니다.`
                ],
                callout: `하루 섭취량을 더 낮추기 전에 단백질·식이섬유·수면·근력운동·활동량을 먼저 점검하는 편이 장기 유지에 더 안전합니다.`,
                evidence: ['KSSO_MGMT_2020', 'USPSTF_BEHAVIOR_2018', 'WHO_PA_2020']
            },
            {
                title: '식사 구성 품질 분석: 같은 칼로리라도 포만감과 지속성은 다릅니다',
                lead: `현재 앱에는 식품별 섭취 기록이 없으므로, 이 페이지는 체중 추세와 입력 섭취량을 바탕으로 식사 품질 점검 항목을 제시합니다.`,
                metrics: [
                    { label: '입력 섭취량', value: `${AppState.settings.intake || 0}kcal/일` },
                    { label: '대표 감량 속도', value: recentRateText },
                    { label: '기록 신뢰도', value: dataConfidenceText },
                    { label: '우선 점검', value: '단백질·섬유·가공도' }
                ],
                paragraphs: [
                    `체중 변화는 에너지 균형의 영향을 받지만, 같은 열량이라도 식품 구성에 따라 배고픔, 포만감, 식후 혈당 변동, 다음 끼니 섭취량, 장기 지속성이 달라질 수 있습니다. 따라서 리포트는 칼로리 숫자만 낮추기보다 식사의 구조를 함께 보도록 설계했습니다.`,
                    `가장 먼저 볼 항목은 매 끼니의 단백질 식품, 채소·과일·통곡류·콩류 같은 섬유 급원, 그리고 액상 열량·과자·배달 음식·초가공 간편식의 빈도입니다. 앱은 식품 사진이나 식단 로그를 직접 분석하지 않으므로, 체중 추세가 예상과 다를 때 이 세 항목을 사용자가 스스로 점검하도록 안내합니다.`,
                    `초가공식품을 자유 섭취하게 한 입원 교차 무작위시험에서는 초가공식품 식단에서 에너지 섭취와 체중 증가가 더 크게 나타났습니다. 모든 가공식품을 금지하라는 뜻은 아니지만, 감량이 정체될 때는 포만감이 낮고 빨리 먹기 쉬운 식품 비중이 늘었는지 확인할 필요가 있습니다.`,
                    `현재 대표 속도는 ${recentRateText}입니다. 체중이 예상보다 덜 줄고 있다면 먼저 섭취량 기록 누락, 주말 식사, 음료·간식·소스·조리유·야식 같은 숨은 열량을 점검하십시오. 반대로 너무 빠르게 줄고 있다면 단백질과 미량영양소가 부족하지 않은지, 피로와 어지러움이 없는지 확인해야 합니다.`,
                    `이 페이지의 결론은 특정 식단 유행을 따르라는 것이 아닙니다. 임상적으로 더 안전한 접근은 충분한 단백질과 섬유를 확보하고, 초가공식품과 액상 열량의 빈도를 줄이며, 본인이 오래 반복할 수 있는 식사 구조를 찾는 것입니다.`
                ],
                callout: `다음 2주 동안 체중과 함께 “단백질 충분/부족”, “채소·섬유 충분/부족”, “초가공·배달·음료 많음/적음”만 체크해도 정체 원인을 훨씬 잘 분리할 수 있습니다.`,
                evidence: ['HALL_UPF_2019', 'KSSO_MGMT_2020', 'BMJ_PRIMARYCARE_2022']
            },
            {
                title: '단백질·저항운동 심화 분석: 체중보다 몸의 기능을 지키는 페이지',
                lead: `체성분 판정은 ${ctx.bodyComp.status || '보류'}이며, 빠른 감량 여부는 ${ctx.speedStatus}입니다.`,
                metrics: [
                    { label: '제지방량 변화', value: ctx.bodyComp.hasData ? formatSignedKg(ctx.bodyComp.leanChange, 1) : '체지방률 기록 부족' },
                    { label: '감량 속도', value: ctx.speedStatus },
                    { label: '주간 감량률', value: weeklyPercentText },
                    { label: '핵심 전략', value: '단백질+저항운동' }
                ],
                paragraphs: [
                    `감량 과정에서 가장 중요한 질문 중 하나는 “체중이 줄었는가”가 아니라 “기능을 잃지 않고 지방을 줄이고 있는가”입니다. 제지방량은 근육, 장기, 뼈, 수분 등을 포함하므로 가정용 체성분계로 완벽히 측정되지는 않지만, 장기 추세를 보면 감량의 질을 판단하는 데 도움이 됩니다.`,
                    ctx.bodyComp.hasData
                        ? `현재 체성분 기록에서는 제지방량 변화가 ${formatSignedKg(ctx.bodyComp.leanChange, 1)}로 추정됩니다. 체지방률 측정 오차를 고려해야 하지만, 제지방 감소가 계속 커지면 감량 속도, 단백질 섭취, 저항운동 강도, 회복 상태를 함께 점검해야 합니다.`
                        : `현재 체지방률 기록이 부족해 제지방 보존 여부를 확정하기 어렵습니다. 이 경우 체중만 보지 말고 허리둘레, 운동 수행 무게와 반복 횟수, 일상 피로, 수면, 식사 포만감을 함께 기록하는 것이 현실적입니다.`,
                    `최근 체계적 문헌고찰·메타분석은 과체중·비만 성인의 감량 중 단백질 섭취를 높이는 전략이 근육량 감소 억제에 도움이 될 수 있음을 보여줍니다. 또한 저항운동은 열량 제한 중 제지방량을 보존하고 체성분을 개선하는 핵심 축입니다.`,
                    `실전에서는 매 끼니 단백질을 분산하고, 주 2회 이상 전신 저항운동을 배치하며, 운동 수행이 급격히 떨어질 정도의 에너지 결손을 피하는 방식이 좋습니다. 신장질환, 간질환, 임신·수유, 고령, 복합질환이 있으면 단백질 목표를 의료진과 따로 정해야 합니다.`,
                    `${speedSafetyText} 이 앱은 단백질 g수를 처방하지 않고, 제지방 감소 신호가 보일 때 전문가 상담과 운동·식사 루틴 점검을 촉발하는 방향으로 작동합니다.`
                ],
                callout: `체중이 잘 줄어도 근력, 컨디션, 월경, 수면, 집중력, 폭식 충동이 악화되면 좋은 감량으로 보지 않습니다.`,
                calloutType: (ctx.bodyComp.hasData && ctx.bodyComp.status === '제지방 감소 주의') || ctx.speedStatus === '빠른 감량' ? 'warning' : '',
                evidence: ['PROTEIN_META_2024', 'RESISTANCE_META_2022', 'LONGLAND_2016', 'MORTON_PROTEIN_2018']
            },
            {
                title: '신체활동·NEAT 분석: 운동 시간보다 하루 전체 움직임을 보는 페이지',
                lead: `현재 앱에는 운동 기록이 없으므로, 체중 추세·감량 속도·정체 신호를 이용해 활동량 점검 필요성을 추정합니다.`,
                metrics: [
                    { label: 'WHO 성인 권고', value: '유산소+주 2회 근력' },
                    { label: '현재 정체 신호', value: ctx.plateau.label },
                    { label: '최근 속도', value: recentRateText },
                    { label: '다음 점검', value: '걸음·근력·좌식시간' }
                ],
                paragraphs: [
                    `운동은 단순히 칼로리를 태우는 도구가 아니라 심폐체력, 근육 기능, 인슐린 민감도, 혈압, 기분, 수면을 함께 다루는 치료적 생활요소입니다. WHO는 성인에게 주당 150~300분 중강도 유산소 활동 또는 75~150분 고강도 활동, 그리고 주 2회 이상 주요 근육군 근력운동을 권고합니다.`,
                    `다만 체중 감량 중에는 의식적인 운동보다 비운동성 활동 열생산, 즉 NEAT가 크게 흔들릴 수 있습니다. 적게 먹고 피로해지면 무의식적으로 덜 걷고, 덜 서 있고, 움직임이 줄어 총소비량이 내려갈 수 있습니다.`,
                    `현재 정체 신호는 ${ctx.plateau.label}이고, 대표 속도는 ${recentRateText}입니다. 정체가 길어지는데 섭취량 기록이 비교적 안정적이라면 운동을 더 강하게 밀어붙이기 전에 하루 걸음 수, 좌식 시간, 계단 사용, 출퇴근 이동, 주말 활동량이 줄었는지 확인하는 편이 안전합니다.`,
                    `저항운동은 특히 감량의 질을 개선합니다. 체중이 천천히 줄어도 허리둘레가 줄고 근력 수행이 유지되면 체성분 변화가 양호할 수 있습니다. 반대로 체중이 빨리 줄어도 운동 수행이 급락하면 제지방 손실 가능성을 의심해야 합니다.`,
                    `앱 차원에서는 운동 로그가 없으므로 직접 처방은 하지 않습니다. 대신 정체·빠른 감량·제지방 감소 신호가 나타날 때 “운동량 증가”만 말하지 않고, 회복 가능한 범위의 활동량과 근력운동을 점검하도록 설계했습니다.`
                ],
                callout: `다음 업데이트 기록에는 가능하면 걸음 수, 근력운동 횟수, 좌식 시간이 긴 날 여부를 함께 남기면 체중 정체 원인 해석이 크게 좋아집니다.`,
                evidence: ['WHO_PA_2020', 'RESISTANCE_META_2022', 'USPSTF_BEHAVIOR_2018']
            },
            {
                title: '수면·회복 분석: 덜 먹는 것만으로 설명되지 않는 감량 변수',
                lead: `수면 기록은 없지만, 체중 변동성 ${ctx.volatility.status}와 최근 속도 ${recentRateText}를 함께 보아 회복 점검 필요성을 안내합니다.`,
                metrics: [
                    { label: '변동성', value: ctx.volatility.status },
                    { label: '평균 일간 변동', value: formatKg(ctx.volatility.meanAbsDiff, 2) },
                    { label: '정체 신호', value: ctx.plateau.label },
                    { label: '회복 점검', value: '수면·스트레스·피로' }
                ],
                paragraphs: [
                    `수면은 체중 관리에서 자주 과소평가됩니다. 수면 부족은 다음 날 식욕, 간식 선택, 피로, 운동 수행, 스트레스 반응, 활동량에 영향을 줄 수 있고, 결과적으로 기록된 체중 추세를 흔들 수 있습니다.`,
                    `과체중 성인을 대상으로 한 수면 연장 무작위시험에서는 수면을 늘리는 중재가 실제 생활 환경에서 에너지 섭취 감소와 음의 에너지 균형에 기여했습니다. 이는 수면이 단순한 보조 요소가 아니라 체중 관리 전략의 한 축이 될 수 있음을 시사합니다.`,
                    `현재 평균 일간 변동폭은 ${formatKg(ctx.volatility.meanAbsDiff, 2)}이고 변동성 상태는 ${ctx.volatility.status}입니다. 수면이 부족한 주에는 수분 저류, 염분 섭취 증가, 야식, 운동 회복 지연이 겹쳐 체중이 일시적으로 오를 수 있습니다.`,
                    `수면이 부족한 상태에서 섭취량을 더 줄이면 단기 체중은 줄 수 있어도 피로, 폭식 반동, 운동 수행 저하, 제지방 감소 위험이 커질 수 있습니다. 그래서 리포트는 감량이 정체될 때 곧바로 절식을 권하지 않고 수면·회복 상태를 먼저 점검하도록 안내합니다.`,
                    `실용적인 방법은 기상 시각 고정, 늦은 카페인 줄이기, 취침 전 과식과 음주 줄이기, 운동 강도와 회복일 조절, 주말 수면 리듬 급변 방지입니다. 불면, 수면무호흡 의심, 심한 주간졸림이 있으면 의료 평가가 필요합니다.`
                ],
                callout: `체중 정체가 이어지는 2주 동안 수면 시간이 함께 줄었다면, 식사량 추가 감축보다 수면 회복을 먼저 실험해 보십시오.`,
                evidence: ['SLEEP_EXTENSION_2022', 'WHO_PA_2020', 'KSSO_MGMT_2020']
            },
            {
                title: '식사 시간·간헐적 단식 해석: 유행보다 안전성과 총섭취량을 우선합니다',
                lead: `현재 리포트는 식사 시간을 기록하지 않으므로, 시간제한식은 자동 권고가 아니라 선택 가능한 행동 도구로만 설명합니다.`,
                metrics: [
                    { label: '시간 기록', value: '앱 입력 없음' },
                    { label: '핵심 판단', value: '총섭취량·지속성' },
                    { label: '주의 대상', value: '저체중·임신·질환' },
                    { label: '현재 속도', value: recentRateText }
                ],
                paragraphs: [
                    `간헐적 단식이나 시간제한식은 많은 사용자가 관심을 갖는 방법이지만, 모든 사람에게 우월한 방법으로 단정할 수 없습니다. 임상시험에서는 열량 제한에 시간제한식을 더해도 추가 이득이 크지 않았던 결과와, 이른 시간대 식사 제한에서 일부 지표가 유리했던 결과가 함께 존재합니다.`,
                    `따라서 이 앱은 시간제한식을 필수 전략으로 추천하지 않습니다. 시간제한식의 효과는 대개 총섭취량 감소, 야식 감소, 식사 구조 단순화, 수면 리듬 개선과 분리하기 어렵습니다. 반대로 공복 시간이 길어져 폭식, 어지러움, 집중력 저하, 운동 수행 저하가 생기면 맞지 않는 전략일 수 있습니다.`,
                    `현재 대표 속도는 ${recentRateText}입니다. 이미 빠르게 줄고 있거나 저체중 범위라면 공복 시간을 더 늘리는 시도는 위험할 수 있습니다. 당뇨병 약, 인슐린, 임신·수유, 섭식장애 병력, 청소년, 고령, 만성질환이 있으면 임의의 장시간 단식을 피하고 의료진과 상의해야 합니다.`,
                    `시간제한식을 선택한다면 “얼마나 오래 굶는가”보다 “식사 시간 안에 충분한 단백질, 섬유, 미량영양소를 먹는가”가 더 중요합니다. 식사 시간이 짧아져 영양 밀도가 낮아지면 체중은 줄어도 건강한 감량으로 보기 어렵습니다.`,
                    `앱의 역할은 시간제한식을 처방하는 것이 아니라, 시간 전략을 사용하더라도 7일 평균, 30일 추세, 제지방 보존, 피로·어지러움·폭식 신호를 함께 확인하도록 돕는 것입니다.`
                ],
                callout: `시간제한식은 “도구”이지 “필수 조건”이 아닙니다. 총섭취량, 식사 질, 수면, 운동, 안전 신호가 더 높은 우선순위입니다.`,
                evidence: ['LOWE_TRE_2020', 'TRE_NEJM_2022', 'EARLY_TRE_2022']
            },
            {
                title: '정체기 의사결정 알고리즘: 더 적게 먹기 전에 원인을 분해합니다',
                lead: `현재 정체 판정은 ${ctx.plateau.label}이며, ${plateauActionText}`,
                metrics: [
                    { label: '현재 정체', value: `${ctx.plateau.current}회 연속` },
                    { label: '최장 정체', value: `${ctx.plateau.longest}회` },
                    { label: '최근 기록 성실도', value: formatPercent(ctx.quality.recentAdherence, 1) },
                    { label: '추세 신뢰도', value: trendReliabilityText }
                ],
                paragraphs: [
                    `정체기는 체중 관리에서 매우 흔합니다. 하지만 정체의 원인을 “대사가 망가졌다”로 바로 해석하면 불필요하게 극단적인 절식이나 과운동으로 이어질 수 있습니다. 이 리포트는 정체를 먼저 데이터 문제, 수분 문제, 행동 문제, 에너지 균형 변화로 나누어 봅니다.`,
                    `1단계는 기록 품질입니다. 최근 30일 성실도는 ${formatPercent(ctx.quality.recentAdherence, 1)}입니다. 기록이 드문 상태라면 정체가 아니라 데이터 공백일 수 있습니다. 같은 조건의 아침 체중이 충분히 쌓여야 정체와 노이즈를 구분할 수 있습니다.`,
                    `2단계는 수분과 장 내용물입니다. 탄수화물, 염분, 월경주기, 변비, 운동 후 근육 손상, 음주, 수면 부족은 지방 변화 없이도 체중을 0.5~2kg 흔들 수 있습니다. 이때는 하루 수치보다 7일 평균을 봐야 합니다.`,
                    `3단계는 실제 행동 변화입니다. 주말 섭취, 음료·간식, 조리유, 외식, 배달 음식, 활동량 감소, 좌식 시간 증가가 누적되면 과거에 통하던 식사량이 현재는 유지 열량에 가까워질 수 있습니다.`,
                    `4단계는 조정입니다. 조정은 작은 단위로 해야 합니다. 섭취량을 무작정 크게 낮추기보다 단백질과 섬유를 확보하고, 초가공식품과 액상 열량을 줄이며, NEAT와 근력운동을 회복하고, 2주 뒤 7일 평균을 다시 비교하는 방식이 안전합니다.`
                ],
                callout: `${plateauActionText}`,
                calloutType: ctx.plateau.current >= 14 ? 'warning' : '',
                evidence: ['SELF_MONITOR_2024', 'VUORINEN_2021', 'KSSO_MGMT_2020']
            },
            {
                title: '심혈관·대사 위험 보조 해석: 체중계 밖의 지표가 필요합니다',
                lead: `현재 BMI는 ${formatNumber(ctx.bmi, 2)}이고 ${ctx.bmiInfo.label} 범위입니다. 다만 BMI만으로 대사 위험을 충분히 판단할 수 없습니다.`,
                metrics: [
                    { label: 'BMI 분류', value: ctx.bmiInfo.label },
                    { label: '허리둘레', value: '앱 입력 없음' },
                    { label: '혈압·혈당·지질', value: '앱 입력 없음' },
                    { label: '권장', value: '검사값 병행' }
                ],
                paragraphs: [
                    `체중 감량의 목적은 체중계 숫자 자체가 아니라 대사 건강, 기능, 삶의 질 개선입니다. BMI는 선별 도구로 유용하지만, 근육량과 지방 분포를 구분하지 못합니다. 특히 복부 지방은 같은 BMI에서도 심혈관·대사 위험을 더 잘 설명할 수 있습니다.`,
                    `현재 앱은 허리둘레, 혈압, 공복혈당, HbA1c, 지질, 간수치, 수면무호흡 증상, 약물 정보를 받지 않습니다. 따라서 이 페이지는 진단이 아니라 “추가로 확인해야 할 지표”를 알려주는 안전장치입니다.`,
                    `한국 성인 기준 BMI 해석은 아시아인에서 대사 위험이 비교적 낮은 BMI부터 증가할 수 있다는 점을 반영합니다. 하지만 BMI가 정상 범위라도 허리둘레가 크거나 혈압·혈당·지질 이상이 있으면 체중만으로 안심할 수 없습니다.`,
                    `정기적으로 확인하면 좋은 항목은 허리둘레, 혈압, 공복혈당 또는 HbA1c, 지질검사, 간기능, 필요 시 갑상샘 기능과 수면무호흡 평가입니다. 기존 질환이 있거나 약을 복용 중이면 체중 변화가 약효와 부작용에 영향을 줄 수 있으므로 의료진 확인이 필요합니다.`,
                    `앱은 향후 허리둘레와 검사값 입력 기능을 추가하면 더 정밀해질 수 있습니다. 현재 버전에서는 BMI와 체중 추세만으로 진단하지 않고, 대사 위험 평가는 의료기관 검사와 연결하도록 안내합니다.`
                ],
                callout: `BMI가 비만 범위이거나 허리둘레가 남성 90cm, 여성 85cm 이상에 가까우면 체중 기록만 보지 말고 혈압·혈당·지질·간수치도 함께 확인하십시오.`,
                evidence: ['KSSO_DIAG_2022', 'WAIST_2020', 'NICE_OBESITY_2025', 'CANADA_CPG_2020']
            },
            {
                title: '감량 중 위험 신호 분석: 멈춰야 할 때를 정해두는 페이지',
                lead: `현재 자동 플래그는 ${ctx.flags.length}개입니다. ${warningText}`,
                metrics: [
                    { label: '자동 경고 수', value: `${ctx.flags.length}개` },
                    { label: '속도 판정', value: ctx.speedStatus },
                    { label: 'BMI 안전성', value: ctx.bmiInfo.label },
                    { label: '위험 대응', value: '증상 시 중단·상담' }
                ],
                paragraphs: [
                    `안전한 체중 관리는 “얼마나 더 뺄 수 있는가”만 묻지 않습니다. 언제 멈추고 확인해야 하는지 미리 정해두어야 합니다. 특히 최근 감량 속도가 빠르거나 BMI가 낮거나, 제지방 감소가 의심되거나, 피로와 어지러움이 동반되면 목표보다 안전이 우선입니다.`,
                    `현재 앱의 자동 경고는 ${ctx.flags.length ? ctx.flags.join(' ') : '뚜렷하게 감지되지 않았습니다.'} 이 판정은 입력된 체중·체지방률·설정값만 보는 제한적 알고리즘이므로, 증상이 있으면 자동 경고가 없어도 의료 평가가 필요합니다.`,
                    `주의해야 할 증상은 실신, 흉통, 호흡곤란, 심한 어지러움, 지속적인 심계항진, 저혈당 증상, 반복 구토, 폭식·보상행동, 월경 중단, 급격한 탈모, 심한 변비, 우상복부 통증, 기존 질환 악화입니다.`,
                    `빠른 체중감량은 일부 사람에서 담석 위험과도 관련될 수 있습니다. 또한 체중관리 과정은 섭식장애 위험을 악화시키지 않도록 설계되어야 합니다. 그래서 이 앱은 극단적 제한, 처벌적 운동, 약물 조정, 검증되지 않은 보충제 사용을 권하지 않습니다.`,
                    `건강한 리포트는 사용자를 더 불안하게 만드는 도구가 아니라, 위험 신호를 빨리 알아차리고 전문가에게 연결하는 도구여야 합니다. 목표 달성보다 더 중요한 것은 회복 가능하고 지속 가능한 상태를 유지하는 것입니다.`
                ],
                callout: `위 증상이 있거나 감량 속도가 현재 체중의 1%/주를 지속적으로 넘으면 체중 목표를 잠시 중단하고 의사 또는 자격 있는 임상영양사와 상의하십시오.`,
                calloutType: ctx.flags.length ? 'warning' : '',
                evidence: ['GALLSTONE_2021', 'EATING_DISORDER_2023', 'CANADA_CPG_2020']
            },
            {
                title: '행동 설계와 환경 처방: 의지력보다 반복 구조를 바꾸는 페이지',
                lead: `다음 행동 실험의 우선 대상은 ${nextExperimentTarget}입니다.`,
                metrics: [
                    { label: '기록 루틴', value: ctx.quality.quality },
                    { label: '취약 요일', value: ctx.weekday.worst ? `${ctx.weekday.worst.name}요일` : '데이터 부족' },
                    { label: '주말-평일 차이', value: weekendDeltaText },
                    { label: '실험 대상', value: nextExperimentTarget }
                ],
                paragraphs: [
                    `행동중재 연구와 임상지침은 체중관리에 식사, 신체활동, 자기모니터링, 문제 해결, 사회적 지지, 재발 방지 같은 다요소 접근이 필요하다고 봅니다. 이는 의지력이 약하다는 뜻이 아니라, 체중은 반복 환경의 영향을 크게 받는다는 뜻입니다.`,
                    `현재 기록 루틴은 ${ctx.quality.quality}이고, 취약 요일은 ${ctx.weekday.worst ? ctx.weekday.worst.name + '요일' : '아직 계산하기 어렵습니다' }입니다. ${adherenceActionText} 주말-평일 평균 변화 차이는 ${weekendDeltaText}입니다.`,
                    `가장 효과적인 행동 설계는 작은 장치를 반복 가능하게 만드는 것입니다. 예를 들어 아침 체중 측정 위치 고정, 단백질 식품 먼저 준비, 배달 앱 알림 끄기, 회식 전 식사 계획, 식후 10분 산책, 취약 요일의 취침 시각 고정처럼 환경 마찰을 줄이는 전략이 좋습니다.`,
                    `실패한 날을 “의지 부족”으로 해석하면 다음 행동을 설계하기 어렵습니다. 대신 어느 시간, 어느 장소, 어떤 사람, 어떤 감정, 어떤 음식 접근성이 체중 패턴을 흔들었는지 기록하면 다음 실험을 정할 수 있습니다.`,
                    `리포트는 다음 2주 동안 한 가지 행동만 바꾸는 방식을 권합니다. 여러 요소를 동시에 바꾸면 무엇이 효과였는지 알기 어렵습니다. 이번 우선 실험은 ${nextExperimentTarget}입니다.`
                ],
                callout: `다음 2주 실험은 하나만 고르십시오. “취약 요일 야식 줄이기”, “매일 같은 조건 기록”, “저항운동 2회 고정”처럼 측정 가능한 행동이 좋습니다.`,
                evidence: ['USPSTF_BEHAVIOR_2018', 'BMJ_PRIMARYCARE_2022', 'SELF_MONITOR_2024']
            },
            {
                title: '감량 유지기 전환 분석: 목표 도달 후가 진짜 장기 관리입니다',
                lead: `목표 체중까지 남은 거리는 ${formatKg(ctx.remaining, 1)}이며, 유지기 예비 범위는 ${maintenanceBandText}로 설정해 볼 수 있습니다.`,
                metrics: [
                    { label: '목표 체중', value: formatKg(ctx.goalWeight, 1) },
                    { label: '남은 체중', value: formatKg(ctx.remaining, 1) },
                    { label: '예비 유지 범위', value: maintenanceBandText },
                    { label: '유지 전략', value: '완충 범위+모니터링' }
                ],
                paragraphs: [
                    `감량의 끝은 체중관리의 끝이 아니라 유지기의 시작입니다. 장기 연구들은 감량 후 체중 재증가가 흔하다는 점을 보여주며, 이는 개인의 실패라기보다 생리적 적응, 식욕 변화, 활동량 변화, 환경 복귀가 함께 만든 결과입니다.`,
                    `따라서 목표 체중 ${formatKg(ctx.goalWeight, 1)}에 도달하면 숫자 하나를 절대선으로 고정하기보다 허용 범위를 정하는 편이 현실적입니다. 예를 들어 예비 유지 범위를 ${maintenanceBandText}처럼 잡고, 그 안에서는 주간 평균을 보며 과잉반응하지 않는 방식입니다.`,
                    `유지기에는 감량기보다 에너지 결손을 줄이고, 단백질과 저항운동을 유지하며, 기록 빈도를 완전히 끊지 않는 것이 중요합니다. 매일 측정이 부담되면 주 2~4회로 줄이더라도 7일 평균 또는 주간 평균은 남겨두는 편이 좋습니다.`,
                    `체중이 허용 범위 위로 올라갈 때는 벌칙처럼 절식하지 말고, 1~2주 단위의 작은 복구 루틴을 사용합니다. 주말 외식 빈도, 액상 열량, 활동량, 수면, 체중 기록 공백을 다시 확인하는 방식입니다.`,
                    `이 앱의 20페이지 리포트는 감량기뿐 아니라 유지기에도 쓰이도록 설계했습니다. 목표 도달 후에는 “더 빼기”보다 “건강 신호와 생활 지속성 유지”를 중심 지표로 바꾸는 것이 안전합니다.`
                ],
                callout: `목표 체중 도달 후 8~12주는 유지기 적응 기간으로 보고, 급격한 추가 감량보다 허용 범위 안에서 안정화하는 것을 우선하십시오.`,
                evidence: ['MAINTENANCE_2022', 'HALL_MAINTENANCE_2018', 'SELF_MONITOR_2024']
            },
            {
                title: '요일·주말·행동 패턴 분석: 반복되는 환경을 찾는 페이지',
                lead: `가장 유리한 요일은 ${bestDay}, 가장 주의가 필요한 요일은 ${worstDay}입니다.`,
                metrics: [
                    { label: '최고 요일', value: bestDay },
                    { label: '주의 요일', value: worstDay },
                    { label: '평일 평균 변화', value: ctx.weekday.weekdayAvg === null ? '-' : formatSignedKg(ctx.weekday.weekdayAvg, 2) },
                    { label: '주말 평균 변화', value: ctx.weekday.weekendAvg === null ? '-' : formatSignedKg(ctx.weekday.weekendAvg, 2) }
                ],
                paragraphs: [
                    `체중은 의지력만의 결과가 아니라 환경 반복의 결과입니다. 특정 요일에 체중이 자주 오르면 그 요일의 외식, 음주, 야식, 수면 부족, 운동 공백, 염분 섭취가 원인일 수 있습니다.`,
                    `현재 기록에서는 ${bestDay}에 체중 변화가 가장 유리하게 나타났고, ${worstDay}에 가장 불리하게 나타났습니다. 이 결과는 원인을 확정하지는 않지만, 점검할 요일을 좁혀 줍니다.`,
                    `주말 평균 변화는 ${ctx.weekday.weekendAvg === null ? '데이터 부족' : formatSignedKg(ctx.weekday.weekendAvg, 2)}이고, 평일 평균 변화는 ${ctx.weekday.weekdayAvg === null ? '데이터 부족' : formatSignedKg(ctx.weekday.weekdayAvg, 2)}입니다. 주말에 오르는 패턴이 반복된다면 월요일 체중 상승을 “실패”가 아니라 “예상 가능한 수분·염분·섭취 패턴”으로 보고, 금요일 저녁부터 월요일 아침까지의 전략을 따로 설계하는 것이 좋습니다.`,
                    `행동중재의 핵심은 큰 결심보다 작은 마찰을 줄이는 것입니다. 예를 들어 외식 전 단백질·채소 우선 섭취, 음료 열량 줄이기, 주말 아침 체중 기록 유지, 늦은 밤 배달 앱 차단, 산책 일정 고정처럼 반복 가능한 장치를 만드는 편이 좋습니다.`,
                    `앱은 요일별 승률과 평균 변화량을 보여주므로, 다음 실험은 “가장 약한 요일 하나”를 대상으로 설계하는 것이 좋습니다. 모든 것을 동시에 바꾸기보다 가장 반복적으로 체중을 올리는 환경 하나를 수정하는 편이 성공 가능성이 높습니다.`
                ],
                callout: `다음 2주 동안은 ${ctx.weekday.worst ? ctx.weekday.worst.name + '요일' : '취약 요일'}의 식사·수면·활동 기록을 더 자세히 남겨 보십시오.`,
                evidence: ['USPSTF_BEHAVIOR_2018', 'SELF_MONITOR_2024', 'VUORINEN_2021']
            },
            {
                title: '목표 달성 전망과 안전 계획: 예측보다 중요한 것은 조정 가능성',
                lead: `목표 예측은 ${forecastText}입니다.`,
                metrics: [
                    { label: '목표 체중', value: formatKg(ctx.goalWeight, 1) },
                    { label: '남은 체중', value: formatKg(ctx.remaining, 1) },
                    { label: '예상일', value: ctx.forecast.available ? ctx.forecast.eta : '보류' },
                    { label: '예측 신뢰도', value: ctx.forecast.available ? ctx.forecast.confidence : '낮음' }
                ],
                paragraphs: [
                    `예측일은 동기부여에는 도움이 되지만, 몸은 직선으로 변하지 않습니다. 앱은 최근 30일 또는 충분한 최근 기록을 바탕으로 선형 추세를 계산하고, 현재 체중에서 목표 체중까지의 거리를 나누어 예상일을 산출합니다.`,
                    ctx.forecast.available
                        ? `현재 추세가 유지된다면 목표 체중 ${formatKg(ctx.goalWeight, 1)}까지 약 ${Math.round(ctx.forecast.daysToGoal)}일이 필요하고, 예상일은 ${ctx.forecast.eta} 전후입니다. 다만 추세 설명력, 기록 수, 생활 변화에 따라 실제 결과는 크게 달라질 수 있습니다.`
                        : `현재는 목표일을 신뢰 있게 계산하기 어렵습니다. 이유는 최근 감량 기울기가 충분히 뚜렷하지 않거나, 기록 수가 부족하거나, 체중이 이미 목표에 가까워졌기 때문입니다.`,
                    `목표가 가까워질수록 감량 속도는 느려지는 것이 자연스럽습니다. 체중이 줄면 필요한 에너지도 줄고, 무의식적 활동량이 감소할 수 있습니다. 따라서 초반 속도를 그대로 끝까지 기대하기보다, 2~4주 단위로 목표 속도를 재설정해야 합니다.`,
                    `안전 계획의 핵심은 중단 기준을 정하는 것입니다. 어지러움, 실신, 흉통, 호흡곤란, 심한 피로, 식사 통제 상실, 폭식·구토, 무월경, 급격한 탈모, 기존 질환 악화, 약물 복용 중 저혈당 증상이 나타나면 감량 목표보다 의료 평가가 우선입니다.`,
                    `목표 달성 후에는 유지 단계가 시작됩니다. 유지 단계에서는 감량기보다 작은 칼로리 결손을 없애고, 체중 허용 범위를 정하고, 기록 빈도를 낮추더라도 주간 평균을 계속 확인하는 방식이 유리합니다.`
                ],
                callout: `목표일은 약속이 아니라 추정입니다. 2~4주마다 새 기록으로 다시 계산하고, 감량 속도보다 건강 신호를 우선하십시오.`,
                evidence: ['KSSO_MGMT_2020', 'CANADA_CPG_2020', 'SLEEP_EXTENSION_2022']
            },
            {
                title: '근거 요약과 해석 한계: 이 리포트가 사용하는 의학 문헌',
                lead: '아래 근거들은 앱의 해석 기준을 구성하는 참고문헌이며, 개인 진단이나 치료 처방을 대신하지 않습니다.',
                metrics: [
                    { label: '근거 범위', value: '2016~2026 우선' },
                    { label: '분석 방식', value: '기록 기반 서술형' },
                    { label: '진단 여부', value: '진단 아님' },
                    { label: '권장 행동', value: '의료진 상담 우선' }
                ],
                paragraphs: [
                    `이 기능은 최근 10년 내 임상지침, 무작위시험, 체계적 문헌고찰을 우선 반영해 구성했습니다. BMI 분류는 한국 성인 기준을 사용하고, 체중 감량 목표는 5~10%의 임상적 의미, 자기모니터링의 행동중재 가치, 신체활동과 근력운동의 역할, 단백질과 제지방 보존, 수면과 에너지 섭취, 체중 변동성 해석을 함께 고려합니다.`,
                    `다만 앱에 없는 정보가 많습니다. 허리둘레, 혈압, 혈당, 지질, 간기능, 갑상샘 기능, 약물, 기저질환, 임신·수유, 섭식장애 위험, 수면무호흡, 운동량, 실제 식사 기록이 없기 때문에 이 리포트는 “기록 기반 위험 신호 탐지와 자기 점검”에 초점을 둡니다.`,
                    `체중과 체지방률 기록은 측정 오차를 포함합니다. 가정용 체지방률은 수분 상태에 크게 흔들릴 수 있고, 체중도 염분·탄수화물·운동·수면·배변에 따라 하루 0.5~2kg까지 변할 수 있습니다.`,
                    `그래서 이 기능은 특정 약물, 극단적 식단, 장시간 단식, 보충제 또는 검증되지 않은 접근을 권하지 않습니다. 건강 결정은 개인의 병력과 검사 결과를 아는 의료진의 평가가 필요합니다.`,
                    `가장 실용적인 다음 단계는 기록의 질을 높이고, 7일 평균과 30일 추세를 보며, 감량 속도가 과하지 않은지 확인하고, 지방 감량과 제지방 보존을 함께 추적하는 것입니다.`
                ],
                callout: `본 리포트는 교육·기록 보조 기능입니다. 질병 진단, 치료, 약물 조정, 식단 처방은 반드시 의사 또는 자격 있는 임상영양사와 상의하십시오.`,
                referencesHtml: refsHtml,
                referencesText: refsText,
                evidence: CONFIG.MEDICAL_EVIDENCE.map(e => e.key)
            }
        ];
    }

    function buildMedicalNarrativeReport(s) {
        if (!AppState.records || AppState.records.length === 0) {
            return { pages: [], html: '<div class="narrative-empty">체중 기록을 입력하면 의학 근거 기반 A4 20페이지 서술형 분석 리포트가 생성됩니다.</div>', plainText: '' };
        }
        const ctx = calcMedicalNarrativeContext(s || analyzeRecords(AppState.records));
        const pages = buildMedicalNarrativePages(ctx);
        const html = pages.map((page, index) => buildPageHtml(page, index, pages.length)).join('');
        const plainText = [
            'MothNote 다이어트 챌린지 - 의학 근거 기반 A4 20페이지 서술형 현재 상태 분석',
            `생성일: ${DateUtil.format(new Date())}`,
            `기록 범위: ${ctx.first.date} ~ ${ctx.last.date}`,
            '',
            ...pages.map((page, index) => buildPageText(page, index, pages.length))
        ].join('\n\n');
        return { pages, html, plainText, ctx };
    }

    function setMedicalNarrativeButtons(enabled) {
        ['btn-copy-medical-narrative', 'btn-download-medical-narrative', 'btn-print-medical-narrative'].forEach(id => {
            const btn = AppState.getEl(id);
            if (btn) btn.disabled = !enabled;
        });
    }

    function renderMedicalNarrativeReport(s, manual = false) {
        const reportEl = AppState.getEl('medicalNarrativeReport');
        const summaryEl = AppState.getEl('medicalNarrativeSummary');
        if (!reportEl || !summaryEl) return;
        const report = buildMedicalNarrativeReport(s);
        DomUtil.setSafeHtml(reportEl, report.html);
        AppState.state.medicalNarrativePlainText = report.plainText;

        if (!report.ctx) {
            summaryEl.textContent = '';
            setMedicalNarrativeButtons(false);
            if (manual) showToast('먼저 체중 기록을 입력해주세요.');
            return;
        }
        const ctx = report.ctx;
        const summaryItems = [
            { label: '현재 BMI', value: `${formatNumber(ctx.bmi, 2)} (${ctx.bmiInfo.label})`, note: '한국 성인 기준' },
            { label: '최근 대표 속도', value: ctx.activeRate ? rateToText(ctx.activeRate.weeklyKg) : '데이터 부족', note: `참고 범위 ${formatKg(ctx.safeWeeklyLow, 2)}~${formatKg(ctx.safeWeeklyHigh, 2)}/주` },
            { label: '기록 성실도', value: formatPercent(ctx.quality.recentAdherence, 1), note: '최근 30일 기준' },
            { label: '체성분 신호', value: ctx.bodyComp.status || '보류', note: ctx.bodyComp.hasData ? `체지방률 ${ctx.bodyComp.fatRecordCount}개` : '체지방률 추가 필요' }
        ];
        DomUtil.setSafeHtml(summaryEl, summaryItems.map(item => `
            <div class="narrative-summary-item">
                <div class="narrative-summary-label">${DomUtil.escapeHtml(item.label)}</div>
                <div class="narrative-summary-value">${DomUtil.escapeHtml(item.value)}</div>
                <div class="narrative-summary-note">${DomUtil.escapeHtml(item.note)}</div>
            </div>
        `).join(''));
        setMedicalNarrativeButtons(true);
        if (manual) showToast('의학 근거 기반 서술형 분석 리포트를 갱신했습니다.');
    }

    function ensureMedicalNarrativeText() {
        if (!AppState.state.medicalNarrativePlainText && AppState.records.length > 0) {
            const report = buildMedicalNarrativeReport(AppState.state.statsCache || analyzeRecords(AppState.records));
            AppState.state.medicalNarrativePlainText = report.plainText;
        }
        return AppState.state.medicalNarrativePlainText || '';
    }

    function fallbackCopyText(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            showToast('리포트 본문을 복사했습니다.');
        } catch (e) {
            showToast('복사에 실패했습니다. 브라우저 권한을 확인해주세요.');
        } finally {
            document.body.removeChild(ta);
        }
    }

    function copyMedicalNarrativeReport() {
        const text = ensureMedicalNarrativeText();
        if (!text) return showToast('복사할 리포트가 없습니다. 먼저 기록을 입력해주세요.');
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text)
                .then(() => showToast('리포트 본문을 복사했습니다.'))
                .catch(() => fallbackCopyText(text));
        } else {
            fallbackCopyText(text);
        }
    }

    function downloadMedicalNarrativeReport() {
        const text = ensureMedicalNarrativeText();
        if (!text) return showToast('저장할 리포트가 없습니다. 먼저 기록을 입력해주세요.');
        const now = new Date();
        const yy = String(now.getFullYear()).slice(2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        downloadFile(text, `${yy}${mm}${dd}_Diet_Medical_Narrative_Report.txt`, 'text/plain;charset=utf-8');
    }

    function printMedicalNarrativeReport() {
        if (AppState.records.length === 0) return showToast('인쇄할 리포트가 없습니다. 먼저 기록을 입력해주세요.');
        renderMedicalNarrativeReport(AppState.state.statsCache || analyzeRecords(AppState.records));
        document.body.classList.add('print-narrative-only');
        window.print();
        setTimeout(() => document.body.classList.remove('print-narrative-only'), 1000);
    }

    function renderAnalysisText(s) {
        const txtEl = AppState.getEl('analysisText');
        if (AppState.records.length < 2) {
            txtEl.innerText = CONFIG.MESSAGES.ANALYSIS.DATA_Need;
            return;
        }
        const last = AppState.records[AppState.records.length-1];
        const prev = AppState.records[AppState.records.length-2];
        const diff = MathUtil.diff(last.weight, prev.weight);
        
        if (diff < 0) txtEl.innerText = CONFIG.MESSAGES.ANALYSIS.LOSS.replace('{diff}', String(Math.abs(diff)));
        else if (diff > 0) txtEl.innerText = CONFIG.MESSAGES.ANALYSIS.GAIN.replace('{diff}', String(diff));
        else txtEl.innerText = CONFIG.MESSAGES.ANALYSIS.MAINTAIN;
    }

    function calculateScenarios(currentW) {
        if(currentW <= AppState.settings.goal1) return { avg: "달성 완료! 🎉", range: "" };
        if(AppState.records.length < 5) return { avg: "데이터 수집 중...", range: "" };
        
        const recent = AppState.records.slice(-30);
        if(recent.length < 2) return { avg: "분석 중...", range: "" };

        const first = recent[0];
        const last = recent[recent.length-1];
        const days = DateUtil.daysBetween(DateUtil.parse(first.date), DateUtil.parse(last.date));
        const totalDiff = MathUtil.diff(first.weight, last.weight);
        const avgRate = totalDiff / (days || 1); 

        if(avgRate <= 0.001) return { avg: "증량/유지세 🤔", range: "식단 조절 필요" };

        const remain = MathUtil.diff(currentW, AppState.settings.goal1);
        const daysLeftAvg = Math.ceil(remain / avgRate);
        
        const fastRate = avgRate * 1.5; 
        const slowRate = avgRate * 0.7;

        const dAvg = new Date(); dAvg.setDate(dAvg.getDate() + daysLeftAvg);
        const dFast = new Date(); dFast.setDate(dFast.getDate() + Math.ceil(remain / fastRate));
        const dSlow = new Date(); dSlow.setDate(dSlow.getDate() + Math.ceil(remain / slowRate));

        const formatDate = (d) => `${d.getMonth()+1}/${d.getDate()}`;
        
        return {
            avg: `${formatDate(dAvg)} (${daysLeftAvg}일 후)`,
            range: `최적 ${formatDate(dFast)} ~ 보수 ${formatDate(dSlow)}`
        };
    }

    // --- 7. 차트 그리기 함수들 ---
    function updateFilterButtons() {
        AppState.getEl('btn-1m').className = 'filter-btn' + (AppState.chartFilterMode==='1M'?' active':'');
        AppState.getEl('btn-3m').className = 'filter-btn' + (AppState.chartFilterMode==='3M'?' active':'');
        AppState.getEl('btn-6m').className = 'filter-btn' + (AppState.chartFilterMode==='6M'?' active':'');
        AppState.getEl('btn-1y').className = 'filter-btn' + (AppState.chartFilterMode==='1Y'?' active':'');
        AppState.getEl('btn-all').className = 'filter-btn' + (AppState.chartFilterMode==='ALL'?' active':'');
    }

    function setChartFilter(mode) {
        const safeMode = sanitizeChartFilterMode(mode);
        if (!persistRawLocalStorageValue(AppState.FILTER_KEY, safeMode, '차트 필터 설정을 저장하지 못했습니다.')) return;
        AppState.chartFilterMode = safeMode;
        updateFilterButtons();
        updateUI(); 
    }

    function applyCustomDateRange() {
        const s = AppState.getEl('chartStartDate').value;
        const e = AppState.getEl('chartEndDate').value;
        if(s && e) {
            if (!DateUtil.isValidDateString(s) || !DateUtil.isValidDateString(e)) return showToast('유효한 날짜 범위를 선택해주세요.');
            if (DateUtil.parse(s) > DateUtil.parse(e)) return showToast('시작일은 종료일보다 늦을 수 없습니다.');
            if (!persistLocalStorageEntriesAtomically([
                { key: AppState.FILTER_KEY, value: 'CUSTOM' },
                { key: AppState.CUSTOM_FILTER_START_KEY, value: s },
                { key: AppState.CUSTOM_FILTER_END_KEY, value: e }
            ], '차트 필터 설정을 저장하지 못했습니다.')) return;
            AppState.chartFilterMode = 'CUSTOM';
            AppState.customStart = s; AppState.customEnd = e;
            document.querySelectorAll('.filter-group .filter-btn').forEach(b=>b.classList.remove('active'));
            updateUI();
        }
    }

    function getFilteredData() {
        if(AppState.records.length === 0) return [];
        let start = DateUtil.parse(AppState.records[0].date);
        let end = new Date(); end.setHours(23,59,59,999);
        const now = new Date(); now.setHours(0,0,0,0);

        if(AppState.chartFilterMode === '1M') { 
            start = DateUtil.addMonthsClamped(now, -1);
        } else if(AppState.chartFilterMode === '3M') { 
            start = DateUtil.addMonthsClamped(now, -3);
        } else if(AppState.chartFilterMode === '6M') { 
            start = DateUtil.addMonthsClamped(now, -6);
        } else if(AppState.chartFilterMode === '1Y') { 
            start = DateUtil.addYearsClamped(now, -1);
        } else if(AppState.chartFilterMode === 'CUSTOM' && AppState.customStart) { 
            start = DateUtil.parse(AppState.customStart);
            end = DateUtil.parse(AppState.customEnd); end.setHours(23,59,59,999);
        }
        
        return AppState.records.filter(r => {
            const d = DateUtil.parse(r.date);
            return d >= start && d <= end;
        });
    }

    function createChartConfig(type, data, options, colors) {
        const defaultOptions = {
            responsive: true,
            maintainAspectRatio: false,
            // [Improvement] Chart Tooltip Readability
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
                y: { ticks: { color: colors.text }, grid: { color: colors.grid } }
            }
        };
        if(options && options.scales) {
             if(options.scales.x) Object.assign(defaultOptions.scales.x, options.scales.x);
             if(options.scales.y) Object.assign(defaultOptions.scales.y, options.scales.y);
        }
        Object.assign(defaultOptions, options);
        return { type, data, options: defaultOptions };
    }

    // [Fix] 차트 인스턴스 중복 생성 방지 강화
    function updateChartHelper(key, ctx, config) {
        // 기존 인스턴스 정리
        const existingInstance = Chart.getChart(ctx);
        if (existingInstance) {
            existingInstance.destroy();
        }
        
        // 내부 캐시 확인 및 정리
        if (AppState.charts[key]) {
            AppState.charts[key].destroy();
            delete AppState.charts[key];
        }

        // 새 차트 생성
        AppState.charts[key] = new Chart(ctx, config);
    }

    function updateMainChart(colors) {
        const ctx = document.getElementById('mainChart').getContext('2d');
        const data = getFilteredData();
        const points = data.map(r => ({ x: r.date, y: r.weight }));
        
        const h = AppState.settings.height / 100;
        const w185 = CONFIG.BMI.UNDER * h * h;
        const w23 = CONFIG.BMI.NORMAL_END * h * h;
        const w25 = CONFIG.BMI.PRE_OBESE_END * h * h;
        
        const chartStart = points.length ? points[0].x : new Date();
        const chartEnd = points.length ? points[points.length-1].x : new Date();

        const trend = [];
        const upperBand = [];
        const lowerBand = [];
        const showTrend = AppState.getEl('showTrend').checked;

        if(showTrend && data.length > 0) {
            for(let i=0; i<data.length; i++) {
                const currentDate = DateUtil.parse(data[i].date);
                const sevenDaysAgo = new Date(currentDate);
                sevenDaysAgo.setDate(currentDate.getDate() - 6);
                
                const windowData = AppState.records.filter(r => {
                    const d = DateUtil.parse(r.date);
                    return d >= sevenDaysAgo && d <= currentDate;
                });
                
                if(windowData.length > 0) {
                     const weights = windowData.map(r => r.weight);
                     const mean = weights.reduce((acc, cur) => acc + cur, 0) / weights.length;
                     trend.push({ x: data[i].date, y: mean });

                     const variance = weights.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / weights.length;
                     const stdDev = Math.sqrt(variance);
                     upperBand.push({ x: data[i].date, y: mean + (2 * stdDev) });
                     lowerBand.push({ x: data[i].date, y: mean - (2 * stdDev) });
                }
            }
        }

        const isDark = document.body.classList.contains('dark-mode');

        const datasets = [
             {
                label: '비만',
                data: [{x: chartStart, y: 150}, {x: chartEnd, y: 150}],
                fill: { target: {value: w25}, above: isDark ? 'rgba(244, 67, 54, 0.1)' : 'rgba(244, 67, 54, 0.05)' },
                borderColor: 'transparent', pointRadius: 0
            },
            {
                label: '비만 전 단계',
                data: [{x: chartStart, y: w25}, {x: chartEnd, y: w25}],
                fill: { target: {value: w23}, above: isDark ? 'rgba(255, 152, 0, 0.1)' : 'rgba(255, 152, 0, 0.05)' },
                borderColor: 'transparent', pointRadius: 0
            },
            {
                label: '정상',
                data: [{x: chartStart, y: w23}, {x: chartEnd, y: w23}],
                fill: { target: {value: w185}, above: isDark ? 'rgba(76, 175, 80, 0.1)' : 'rgba(76, 175, 80, 0.05)' },
                borderColor: 'transparent', pointRadius: 0
            },
            {
                label: '체중',
                data: points,
                borderColor: colors.primary,
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                fill: false,
                tension: 0.1,
                pointRadius: 3
            },
            ...(showTrend ? [{
                label: '7일 추세',
                data: trend,
                borderColor: colors.secondary, 
                borderWidth: 2,
                pointRadius: 0,
                fill: false,
                tension: 0.4
            }, {
                label: 'Bollinger Upper',
                data: upperBand,
                borderColor: 'transparent',
                pointRadius: 0,
                fill: '+1', 
                backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'
            }, {
                label: 'Bollinger Lower',
                data: lowerBand,
                borderColor: 'transparent',
                pointRadius: 0
            }] : []),
            {
                label: '목표',
                data: data.length ? [{x: data[0].date, y: AppState.settings.goal1}, {x: data[data.length-1].date, y: AppState.settings.goal1}] : [],
                borderColor: colors.secondary,
                borderDash: [5,5],
                pointRadius: 0,
                borderWidth: 1
            }
        ];

        const config = createChartConfig('line', { datasets }, {
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'day', displayFormats: { day: 'MM/dd' } }
                },
                y: {
                    max: points.length > 0 ? Math.ceil(Math.max(...points.map(p => p.y), AppState.settings.startWeight)) + 1 : AppState.settings.startWeight + 1,
                    suggestedMin: AppState.settings.goal1 - 2
                }
            },
            plugins: {
                tooltip: { mode: 'index', intersect: false },
                legend: {
                    labels: {
                        color: colors.text,
                        filter: function(item) { return !['비만', '비만 전 단계', '정상', 'Bollinger Upper', 'Bollinger Lower'].includes(item.text); }
                    }
                }
            }
        }, colors);

        updateChartHelper('main', ctx, config);
    }

    function updateGhostRunnerChart(colors) {
        if(AppState.records.length === 0) return;
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();

        const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
        const lastMonth = lastMonthDate.getMonth();
        const lastMonthYear = lastMonthDate.getFullYear();

        const getMonthData = (m, y) => {
            const daysInMonth = DateUtil.getDaysInMonth(y, m);
            const data = new Array(31).fill(null);
            
            AppState.records.forEach(r => {
                const d = DateUtil.parse(r.date);
                if(d.getMonth() === m && d.getFullYear() === y) {
                    data[d.getDate() - 1] = r.weight;
                }
            });

            return data.map((val, idx) => (idx < daysInMonth ? val : null));
        };

        const currentData = getMonthData(thisMonth, thisYear);
        const previousData = getMonthData(lastMonth, lastMonthYear);

        const ctx = document.getElementById('ghostRunnerChart').getContext('2d');
        const config = createChartConfig('line', {
            labels: Array.from({length: 31}, (_, i) => `${i+1}일`),
            datasets: [
                {
                    label: '이번 달',
                    data: currentData,
                    borderColor: colors.primary,
                    backgroundColor: colors.primary,
                    borderWidth: 3,
                    tension: 0.3,
                    spanGaps: true
                },
                {
                    label: '지난달',
                    data: previousData,
                    borderColor: 'rgba(150, 150, 150, 0.3)',
                    backgroundColor: 'rgba(150, 150, 150, 0.1)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: true,
                    tension: 0.3,
                    spanGaps: true
                }
            ]
        }, {}, colors);

        updateChartHelper('ghostRunner', ctx, config);
    }

    function updateGaugeCharts(colors) {
        const lastRec = AppState.records[AppState.records.length - 1];
        if(!lastRec) return;

        const hMeter = AppState.settings.height / 100;
        const bmi = Math.round((lastRec.weight / (hMeter * hMeter)) * 100) / 100;
        const fat = lastRec.fat || 0;

		const createGauge = (id, val, max, ranges, chartKey) => {
			const ctx = document.getElementById(id).getContext('2d');
			const config = {
				type: 'doughnut',
				data: {
					datasets: [{
						data: [...ranges.map(r => r.size), 0],
						backgroundColor: [...ranges.map(r => r.color), 'transparent'],
						borderWidth: 0
					}]
				},
				options: {
					circumference: 180,
					rotation: 270,
					cutout: '75%',
					responsive: true,
					maintainAspectRatio: false,
					layout: { padding: { bottom: 10 } },
					plugins: {
						legend: { display: false },
						tooltip: { enabled: false }
					}
				},
				plugins: [{
					id: 'gaugeNeedle',
					afterDraw: (chart) => {
						const { ctx, chartArea: { width, height } } = chart;
						const meta = chart.getDatasetMeta(0);
						if (!meta.data[0]) return; 

						const outerRadius = meta.data[0].outerRadius;
						const centerX = meta.data[0].x;
						const centerY = meta.data[0].y;

						ctx.save();
						const total = ranges.reduce((a, b) => a + b.size, 0);
                        const ratio = Math.min(val, total) / total;
						const angle = Math.PI + (Math.PI * ratio);

						ctx.translate(centerX, centerY);
						ctx.rotate(angle);
						ctx.beginPath();
						ctx.moveTo(0, -(outerRadius * 0.03)); 
						ctx.lineTo(outerRadius * 0.9, 0); 
						ctx.lineTo(0, (outerRadius * 0.03));
						ctx.closePath();
						ctx.fillStyle = colors.text;
						ctx.fill();
						ctx.restore();

						const fontSize = Math.round(outerRadius * 0.22);
						ctx.font = `bold ${fontSize}px sans-serif`;
						ctx.fillStyle = colors.text;
						ctx.textAlign = 'center';
						ctx.textBaseline = 'middle';

						let displayVal = val;
						if (!Number.isInteger(val)) {
							displayVal = val.toFixed(2);
						}
						ctx.fillText(displayVal, centerX, centerY - (outerRadius * 0.2));

					}
				}]
			};
			updateChartHelper(chartKey, ctx, config);
		};
		
        const bmiRanges = [
            { size: CONFIG.BMI.UNDER, color: '#90caf9' }, // 저체중
            { size: CONFIG.BMI.NORMAL_END - CONFIG.BMI.UNDER, color: '#a5d6a7' }, // 정상
            { size: CONFIG.BMI.PRE_OBESE_END - CONFIG.BMI.NORMAL_END, color: '#fff59d' }, // 비만 전
            { size: CONFIG.BMI.OBESE_1_END - CONFIG.BMI.PRE_OBESE_END, color: '#ffcc80' }, // 1단계
            { size: CONFIG.BMI.OBESE_2_END - CONFIG.BMI.OBESE_1_END, color: '#ef9a9a' }, // 2단계
        ];
        
        createGauge('gaugeBmiChart', bmi, 45, bmiRanges, 'gaugeBmi');

        createGauge('gaugeFatChart', fat, 50, [
            { size: 15, color: '#a5d6a7' }, 
            { size: 10, color: '#fff59d' }, 
            { size: 10, color: '#ffcc80' }, 
            { size: 15, color: '#ef9a9a' }  
        ], 'gaugeFat');
    }

    function updateDayOfWeekChart(colors) {
        if(AppState.records.length < 2) return;
        const sums = [0,0,0,0,0,0,0];
        const counts = [0,0,0,0,0,0,0];
        
        for(let i=1; i<AppState.records.length; i++) {
            const diff = MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight);
            const day = DateUtil.parse(AppState.records[i].date).getDay();
            sums[day] = MathUtil.add(sums[day], diff);
            counts[day]++;
        }
        
        const avgs = sums.map((s, i) => counts[i] ? s/counts[i] : 0);
        const ctx = document.getElementById('dayOfWeekChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: ['일','월','화','수','목','금','토'],
            datasets: [{
                label: '평균 변화(kg)',
                data: avgs,
                backgroundColor: avgs.map(v => v>0 ? CONFIG.COLORS.GAIN : '#c8e6c9'),
                borderColor: avgs.map(v => v>0 ? '#e57373':'#81c784'),
                borderWidth: 1
            }]
        }, { plugins: { legend: { display: false } } }, colors);

        updateChartHelper('dow', ctx, config);
    }

    function updateHistogram(colors) {
        if(AppState.records.length === 0) return;
        const weights = AppState.records.map(r => r.weight);
        const min = Math.floor(Math.min(...weights));
        const max = Math.ceil(Math.max(...weights));
        
        const labels = [];
        const data = [];
        for(let i=min; i<=max; i++) {
            labels.push(i + 'kg대');
            data.push(weights.filter(w => Math.floor(w) === i).length);
        }

        const ctx = document.getElementById('histogramChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: labels,
            datasets: [{
                label: '일수',
                data: data,
                backgroundColor: colors.secondary,
                borderRadius: 4
            }]
        }, { plugins: { legend: { display: false } } }, colors);

        updateChartHelper('hist', ctx, config);
    }

    function updateCumulativeChart(colors) {
        if(AppState.records.length === 0) return;
        const points = AppState.records.map(r => ({
            x: r.date,
            y: MathUtil.round(AppState.settings.startWeight - r.weight, 2)
        }));

        const ctx = document.getElementById('cumulativeChart').getContext('2d');
        const config = createChartConfig('line', {
            datasets: [{
                label: '누적 감량(kg)',
                data: points,
                borderColor: '#9C27B0',
                backgroundColor: 'rgba(156, 39, 176, 0.2)',
                fill: true,
                tension: 0.2,
                pointRadius: 1
            }]
        }, {
            scales: {
                x: { type: 'time', time: { unit: 'month' } },
                y: { beginAtZero: true }
            },
            plugins: { legend: { display: false } }
        }, colors);

        updateChartHelper('cumul', ctx, config);
    }

    function updateMonthlyChangeChart(colors) {
        if(AppState.records.length === 0) return;
        
        const months = {};
        AppState.records.forEach(r => {
            const key = r.date.substring(0, 7);
            if(!months[key]) months[key] = [];
            months[key].push(r.weight);
        });

        const labels = [];
        const data = [];
        const bgColors = [];

        Object.keys(months).sort().forEach(m => {
            const arr = months[m];
            const change = MathUtil.diff(arr[arr.length-1], arr[0]); 
            labels.push(m);
            data.push(change);
            bgColors.push(change > 0 ? CONFIG.COLORS.GAIN : CONFIG.COLORS.LOSS);
        });

        const ctx = document.getElementById('monthlyChangeChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: labels,
            datasets: [{
                label: '월별 변화(kg)',
                data: data,
                backgroundColor: bgColors,
                borderWidth: 0
            }]
        }, {
            scales: { y: { beginAtZero: true } },
            plugins: { legend: { display: false } }
        }, colors);

        updateChartHelper('monthly', ctx, config);
    }

    function updateBodyFatChart(colors) {
        const fatData = AppState.records.filter(r => r.fat).map(r => ({ x: r.date, y: r.fat }));
        if(fatData.length === 0) return;

        const ctx = document.getElementById('bodyFatChart').getContext('2d');
        const config = createChartConfig('line', {
            datasets: [{
                label: '체지방률(%)',
                data: fatData,
                borderColor: '#FF5722',
                backgroundColor: 'rgba(255, 87, 34, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 2
            }]
        }, {
            scales: { x: { type: 'time', time: { unit: 'month' } } },
            plugins: { legend: { display: false } }
        }, colors);

        updateChartHelper('fat', ctx, config);
    }

    function updateScatterChart(colors) {
        const data = AppState.records.filter(r => r.fat).map(r => ({ x: r.weight, y: r.fat }));
        if(data.length === 0) return;

        const ctx = document.getElementById('scatterChart').getContext('2d');
        const config = createChartConfig('scatter', {
            datasets: [{
                label: '체중(kg) vs 체지방(%)',
                data: data,
                backgroundColor: colors.secondary
            }]
        }, {
            scales: {
                x: { title: { display: true, text: '체중 (kg)' } },
                y: { title: { display: true, text: '체지방 (%)' } }
            }
        }, colors);

        updateChartHelper('scatter', ctx, config);
    }

    function updateWeekendChart(colors) {
        if(AppState.records.length < 2) return;
        const weekdayDeltas = [], weekendDeltas = [];
        
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date).getDay();
            const diff = MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight);
            if(d === 0 || d === 6) weekendDeltas.push(diff);
            else weekdayDeltas.push(diff);
        }

        const avgWeekday = weekdayDeltas.length ? weekdayDeltas.reduce((a,b)=>a+b,0)/weekdayDeltas.length : 0;
        const avgWeekend = weekendDeltas.length ? weekendDeltas.reduce((a,b)=>a+b,0)/weekendDeltas.length : 0;

        const chartData = [avgWeekday, avgWeekend];

        const ctx = document.getElementById('weekendChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: ['평일 (월~금)', '주말 (토~일)'],
            datasets: [{
                label: '평균 변화량 (kg)',
                data: chartData,
                backgroundColor: [colors.primary, colors.danger],
                barThickness: 50
            }]
        }, { plugins: { legend: { display: false } } }, colors);

        updateChartHelper('weekend', ctx, config);
    }

    function updateBodyCompStackedChart(colors) {
        const fatRecs = AppState.records.filter(r => r.fat);
        if(fatRecs.length < 2) return;

        const fatKg = fatRecs.map(r => ({ x: r.date, y: r.weight * (r.fat/100) }));
        const leanKg = fatRecs.map(r => ({ x: r.date, y: r.weight * (1 - r.fat/100) }));

        const ctx = document.getElementById('bodyCompStackedChart').getContext('2d');
        const config = createChartConfig('line', {
            datasets: [
                {
                    label: '제지방량 (kg)',
                    data: leanKg,
                    borderColor: colors.primary,
                    backgroundColor: 'rgba(76, 175, 80, 0.5)',
                    fill: true
                },
                {
                    label: '체지방량 (kg)',
                    data: fatKg,
                    borderColor: colors.danger,
                    backgroundColor: 'rgba(244, 67, 54, 0.5)',
                    fill: true
                }
            ]
        }, {
            scales: {
                x: { type: 'time', time: { unit: 'month' } },
                y: { stacked: true }
            }
        }, colors);

        updateChartHelper('bodyComp', ctx, config);
    }

    function updateWeeklyBodyCompChart(colors) {
        const fatRecs = AppState.records.filter(r => r.fat);
        if(fatRecs.length < 2) return;
        
        const weeks = {};
        fatRecs.forEach(r => {
            const d = DateUtil.parse(r.date);
            const day = d.getDay(), diff = d.getDate() - day + (day == 0 ? -6:1);
            const monday = new Date(d.setDate(diff));
            const key = DateUtil.format(monday);
            weeks[key] = {
                lbm: r.weight * (1 - r.fat/100),
                fat: r.weight * (r.fat/100)
            };
        });
        
        const labels = Object.keys(weeks).sort();
        const lbmData = labels.map(k => weeks[k].lbm);
        const fatData = labels.map(k => weeks[k].fat);
        
        const ctx = document.getElementById('weeklyBodyCompChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: labels,
            datasets: [
                {
                    label: '제지방량 (kg)',
                    data: lbmData,
                    backgroundColor: colors.primary,
                    stack: 'Stack 0'
                },
                {
                    label: '체지방량 (kg)',
                    data: fatData,
                    backgroundColor: colors.danger,
                    stack: 'Stack 0'
                }
            ]
        }, {
            scales: { x: { display: false }, y: { stacked: true } },
            plugins: { legend: { display: true } }
        }, colors);
        
        updateChartHelper('weeklyBodyComp', ctx, config);
    }
    
    function updateWeightSpeedScatterChart(colors) {
        if(AppState.records.length < 2) return;
        const data = [];
        for(let i=1; i<AppState.records.length; i++) {
            const diff = AppState.records[i-1].weight - AppState.records[i].weight; 
            data.push({ x: AppState.records[i-1].weight, y: diff });
        }
        
        const ctx = document.getElementById('weightSpeedScatterChart').getContext('2d');
        const config = createChartConfig('scatter', {
            datasets: [{
                label: '체중(kg) vs 감량속도(kg/일)',
                data: data,
                backgroundColor: colors.secondary
            }]
        }, {
            scales: {
                x: { title: { display: true, text: '체중 (kg)' } },
                y: { title: { display: true, text: '일일 감량량 (kg)' } }
            }
        }, colors);
        updateChartHelper('weightSpeedScatter', ctx, config);
    }

    function updateMonthlyBoxPlotChart(colors) {
        if(AppState.records.length === 0) return;
        
        const months = {};
        AppState.records.forEach(r => {
            const key = r.date.substring(0, 7);
            if(!months[key]) months[key] = [];
            months[key].push(r.weight);
        });

        const labels = Object.keys(months).sort();
        const barData = []; 
        const scatterData = []; 

        labels.forEach(m => {
            const arr = months[m];
            const min = Math.min(...arr);
            const max = Math.max(...arr);
            arr.sort((a,b)=>a-b);
            const median = arr[Math.floor(arr.length/2)];
            
            barData.push([min, max]);
            scatterData.push(median);
        });

        const ctx = document.getElementById('monthlyBoxPlotChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: labels,
            datasets: [
                {
                    type: 'bar',
                    label: '범위 (Min-Max)',
                    data: barData,
                    backgroundColor: 'rgba(33, 150, 243, 0.3)',
                    borderColor: colors.secondary,
                    borderWidth: 1,
                    barPercentage: 0.5
                },
                {
                    type: 'line',
                    label: '중앙값',
                    data: scatterData,
                    borderColor: colors.text,
                    backgroundColor: colors.text,
                    borderWidth: 0,
                    pointRadius: 4,
                    pointStyle: 'rectRot'
                }
            ]
        }, { scales: { y: { beginAtZero: false } } }, colors);

        updateChartHelper('boxPlot', ctx, config);
    }

    function updateRocChart(colors) {
        if(AppState.records.length < 2) return;
        const data = [];
        for(let i=1; i<AppState.records.length; i++) {
            data.push({
                x: AppState.records[i].date,
                y: MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight)
            });
        }

        const ctx = document.getElementById('rocChart').getContext('2d');
        const config = createChartConfig('line', {
            datasets: [{
                label: '일일 변화량 (kg)',
                data: data,
                borderColor: colors.text,
                borderWidth: 1,
                pointRadius: 1,
                segment: {
                    borderColor: ctx => ctx.p0.parsed.y > 0 ? colors.danger : colors.primary
                }
            }]
        }, {
            scales: { x: { type: 'time', time: { unit: 'day' } } },
            plugins: { legend: { display: false } }
        }, colors);

        updateChartHelper('roc', ctx, config);
    }

    function updateWaterfallChart(colors) {
        if(AppState.records.length < 2) return;
        const startW = AppState.records[0].weight;
        const currentW = AppState.records[AppState.records.length - 1].weight;
        const diff = currentW - startW;

        const data = [
            [0, startW],
            [startW, startW + diff],
            [0, currentW]
        ];

        const bgColors = [colors.secondary, diff < 0 ? colors.primary : colors.danger, colors.text];

        const ctx = document.getElementById('waterfallChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: ['시작 체중', '변화량', '현재 체중'],
            datasets: [{
                label: '체중 흐름',
                data: data,
                backgroundColor: bgColors,
                borderWidth: 0
            }]
        }, {
            plugins: { legend: { display: false } },
            scales: { x: { grid: { display: false } } }
        }, colors);

        updateChartHelper('waterfall', ctx, config);
    }

    function updateSeasonalityChart(colors) {
        if(AppState.records.length === 0) return;
        
        const years = {};
        AppState.records.forEach(r => {
            const d = DateUtil.parse(r.date);
            const y = d.getFullYear();
            if(!years[y]) years[y] = [];
            const normalizedDate = new Date(2000, d.getMonth(), d.getDate());
            years[y].push({ x: normalizedDate, y: r.weight });
        });

        const datasets = Object.keys(years).map((y, idx) => {
            const colorList = [colors.primary, colors.secondary, colors.accent, colors.danger];
            return {
                label: y + '년',
                data: years[y],
                borderColor: colorList[idx % colorList.length],
                fill: false,
                tension: 0.3,
                pointRadius: 1
            };
        });

        const ctx = document.getElementById('seasonalityChart').getContext('2d');
        const config = createChartConfig('line', {
            datasets: datasets
        }, {
            scales: {
                x: { 
                    type: 'time', 
                    time: { unit: 'month', displayFormats: { month: 'MMM' } } 
                }
            }
        }, colors);

        updateChartHelper('seasonality', ctx, config);
    }

    function updateBellCurveChart(colors) {
        if(AppState.records.length < 2) return;
        const deltas = [];
        for(let i=1; i<AppState.records.length; i++) {
            deltas.push(MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight));
        }

        const buckets = {};
        deltas.forEach(d => {
            const bucket = Math.round(d * 10) / 10;
            if(!buckets[bucket]) buckets[bucket] = 0;
            buckets[bucket]++;
        });

        const labels = Object.keys(buckets).sort((a,b)=>parseFloat(a)-parseFloat(b));
        const data = labels.map(l => buckets[l]);

        const ctx = document.getElementById('bellCurveChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: labels,
            datasets: [{
                label: '빈도수',
                data: data,
                backgroundColor: colors.secondary,
                borderRadius: 4
            }]
        }, {
            scales: { x: { title: { display: true, text: '일일 변동량 (kg)' } } },
            plugins: { legend: { display: false } }
        }, colors);

        updateChartHelper('bellCurve', ctx, config);
    }
    
    function updateRadarChart(colors) {
        if(AppState.records.length < 2) return;
        const lossSum = [0,0,0,0,0,0,0];
        const count = [0,0,0,0,0,0,0];
        const gainCount = [0,0,0,0,0,0,0];
        
        for(let i=1; i<AppState.records.length; i++) {
             const d = DateUtil.parse(AppState.records[i].date).getDay();
             const diff = AppState.records[i-1].weight - AppState.records[i].weight; // Loss
             lossSum[d] += diff;
             count[d]++;
             if(diff < -0.3) gainCount[d]++; // Significant gain
        }

        const avgLoss = lossSum.map((s,i) => count[i] ? s/count[i] : 0);
        const maxLoss = Math.max(...avgLoss.map(Math.abs));
        const normAvgLoss = avgLoss.map(v => v > 0 ? (v/maxLoss)*100 : 0); // Only show positive loss strength
        const freq = count.map(c => (c / Math.max(...count)) * 100);
        const overeat = gainCount.map((c, i) => count[i] ? (c / count[i]) * 100 : 0);

        const ctx = document.getElementById('radarChart').getContext('2d');
        const config = createChartConfig('radar', {
            labels: ['일','월','화','수','목','금','토'],
            datasets: [
                {
                    label: '평균 감량 강도',
                    data: normAvgLoss,
                    borderColor: colors.primary,
                    backgroundColor: 'rgba(76, 175, 80, 0.2)'
                },
                {
                    label: '기록 빈도',
                    data: freq,
                    borderColor: colors.secondary,
                    backgroundColor: 'rgba(33, 150, 243, 0.2)'
                },
                {
                    label: '증량(과식) 비율',
                    data: overeat,
                    borderColor: colors.danger,
                    backgroundColor: 'rgba(244, 67, 54, 0.2)'
                }
            ]
        }, {
            scales: {
                r: {
                    angleLines: { color: colors.grid },
                    grid: { color: colors.grid },
                    pointLabels: { color: colors.text },
                    suggestedMin: 0,
                    suggestedMax: 100
                }
            }
        }, colors);
        updateChartHelper('radar', ctx, config);
    }

    function updateCandleStickChart(colors) {
        if(AppState.records.length < 2) return;
        
        const weeks = {};
        AppState.records.forEach(r => {
            const d = DateUtil.parse(r.date);
            const day = d.getDay();
            const diff = d.getDate() - day + (day == 0 ? -6 : 1); // Monday
            const monday = new Date(d.setDate(diff));
            monday.setHours(0,0,0,0);
            const key = monday.getTime();
            if(!weeks[key]) weeks[key] = [];
            weeks[key].push(r.weight);
        });

        const labels = [];
        const data = [];
        const bgColors = [];

        Object.keys(weeks).sort().forEach(k => {
            const wData = weeks[k];
            const min = Math.min(...wData);
            const max = Math.max(...wData);
            const open = wData[0];
            const close = wData[wData.length-1];
            
            const d = new Date(parseInt(k));
            labels.push(DateUtil.format(d).substring(5)); // MM-DD
            data.push([min, max]); // Floating bar for Range
            bgColors.push(close < open ? colors.primary : colors.danger);
        });

        const ctx = document.getElementById('candleStickChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: labels,
            datasets: [{
                label: '주간 변동 범위 (Min-Max)',
                data: data,
                backgroundColor: bgColors,
                borderWidth: 1,
                borderColor: colors.text,
                barPercentage: 0.6
            }]
        }, {
             plugins: { 
                 legend: { display: false },
                 tooltip: {
                     callbacks: {
                         label: (ctx) => `범위: ${ctx.raw[0]} ~ ${ctx.raw[1]}`
                     }
                 }
            }
        }, colors);
        updateChartHelper('candleStick', ctx, config);
    }
    
    function updateMacdChart(colors) {
        if(AppState.records.length < 26) return;
        
        const prices = AppState.records.map(r => r.weight);
        const dates = AppState.records.map(r => r.date);
        
        const calcEma = (data, period) => {
            const k = 2 / (period + 1);
            let emaArr = [data[0]];
            for(let i=1; i<data.length; i++) {
                emaArr.push(data[i] * k + emaArr[i-1] * (1 - k));
            }
            return emaArr;
        };

        const ema12 = calcEma(prices, 12);
        const ema26 = calcEma(prices, 26);
        const macdLine = ema12.map((v, i) => v - ema26[i]);
        const signalLine = calcEma(macdLine, 9);
        const histogram = macdLine.map((v, i) => v - signalLine[i]);

        const sliceIdx = Math.max(0, prices.length - 60);
        
        const ctx = document.getElementById('macdChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: dates.slice(sliceIdx),
            datasets: [
                {
                    type: 'bar',
                    label: 'MACD Hist',
                    data: histogram.slice(sliceIdx),
                    backgroundColor: histogram.slice(sliceIdx).map(v => v < 0 ? colors.primary : colors.danger)
                },
                {
                    type: 'line',
                    label: 'MACD',
                    data: macdLine.slice(sliceIdx),
                    borderColor: colors.text,
                    borderWidth: 1,
                    pointRadius: 0
                },
                {
                    type: 'line',
                    label: 'Signal',
                    data: signalLine.slice(sliceIdx),
                    borderColor: colors.accent,
                    borderWidth: 1,
                    pointRadius: 0
                }
            ]
        }, { scales: { x: { display: false } } }, colors);
        updateChartHelper('macd', ctx, config);
    }

    function updateSeasonalSpiralChart(colors) {
        if(AppState.records.length === 0) return;
        const now = new Date();
        const thisYear = now.getFullYear();
        const lastYear = thisYear - 1;
        
        const getDataForYear = (y) => {
            const months = new Array(12).fill(null);
            AppState.records.forEach(r => {
                const d = DateUtil.parse(r.date);
                if(d.getFullYear() === y) {
                    const m = d.getMonth();
                    if(months[m] === null) months[m] = { sum: 0, count: 0 };
                    months[m].sum += r.weight;
                    months[m].count++;
                }
            });
            return months.map(m => m ? m.sum/m.count : null);
        };

        const dThis = getDataForYear(thisYear);
        const dLast = getDataForYear(lastYear);

        const ctx = document.getElementById('seasonalSpiralChart').getContext('2d');
        const config = createChartConfig('radar', {
            labels: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
            datasets: [
                {
                    label: `${thisYear}년`,
                    data: dThis,
                    borderColor: colors.primary,
                    backgroundColor: 'rgba(76, 175, 80, 0.2)'
                },
                {
                    label: `${lastYear}년`,
                    data: dLast,
                    borderColor: colors.secondary,
                    backgroundColor: 'rgba(33, 150, 243, 0.2)'
                }
            ]
        }, {
            scales: { r: { angleLines: { display: true }, grid: { circular: true } } }
        }, colors);
        updateChartHelper('seasonalSpiral', ctx, config);
    }
    
    // --- [NEW] 새로운 차트 함수들 ---
    
    function updateControlChart(colors) {
        if(AppState.records.length < 5) return;
        
        const weights = AppState.records.map(r => r.weight);
        const mean = MathUtil.mean(weights);
        const stdDev = MathUtil.stdDev(weights);
        const ucl = mean + (3 * stdDev);
        const lcl = mean - (3 * stdDev);
        
        const dates = AppState.records.map(r => r.date);

        const ctx = document.getElementById('controlChart').getContext('2d');
        const config = createChartConfig('line', {
            labels: dates,
            datasets: [
                {
                    label: '체중',
                    data: weights,
                    borderColor: colors.text,
                    pointRadius: 2,
                    borderWidth: 1,
                    fill: false
                },
                {
                    label: 'Mean',
                    data: new Array(weights.length).fill(mean),
                    borderColor: colors.accent,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    borderWidth: 2
                },
                {
                    label: 'UCL (+3σ)',
                    data: new Array(weights.length).fill(ucl),
                    borderColor: colors.danger,
                    borderDash: [2, 2],
                    pointRadius: 0,
                    borderWidth: 1
                },
                {
                    label: 'LCL (-3σ)',
                    data: new Array(weights.length).fill(lcl),
                    borderColor: colors.primary,
                    borderDash: [2, 2],
                    pointRadius: 0,
                    borderWidth: 1
                }
            ]
        }, {
             plugins: { 
                 legend: { display: false },
                 tooltip: { intersect: false }
            },
            scales: { x: { display: false } }
        }, colors);
        
        updateChartHelper('controlChart', ctx, config);
    }
    
    function updateViolinChart(colors) {
        if(AppState.records.length === 0) return;
        
        const scatterData = [];
        
        AppState.records.forEach(r => {
             const d = DateUtil.parse(r.date);
             const monthStr = DateUtil.format(d).substring(0, 7); // YYYY-MM
             const jitter = (d.getDate() % 10 - 5) / 30; 
             
             scatterData.push({
                 x: monthStr, 
                 y: r.weight,
                 xOffset: jitter 
             });
        });
        
        const uniqueMonths = [...new Set(scatterData.map(d => d.x))].sort();
        const mappedData = scatterData.map(d => {
            const idx = uniqueMonths.indexOf(d.x);
            const jitter = (Math.random() - 0.5) * 0.6;
            return { x: idx + jitter, y: d.y, month: d.x };
        });
        
        const ctx = document.getElementById('violinChart').getContext('2d');
        const config = createChartConfig('scatter', {
            datasets: [{
                label: '체중 분포 (밀도)',
                data: mappedData,
                backgroundColor: 'rgba(33, 150, 243, 0.4)',
                borderColor: 'rgba(33, 150, 243, 0.8)',
                pointRadius: 3
            }]
        }, {
             scales: {
                 x: {
                     type: 'linear',
                     ticks: {
                         callback: function(val, index) {
                             if (Math.abs(val - Math.round(val)) < 0.1 && uniqueMonths[Math.round(val)]) {
                                 return uniqueMonths[Math.round(val)];
                             }
                             return '';
                         }
                     },
                     grid: { display: false }
                 }
             },
             plugins: {
                 tooltip: {
                     callbacks: {
                         label: (ctx) => `${ctx.raw.month}: ${ctx.raw.y}kg`
                     }
                 },
                 legend: { display: false }
             }
        }, colors);
        
        updateChartHelper('violinChart', ctx, config);
    }

    function updateGithubStyleCalendar() {
        const container = AppState.getEl('githubCalendarChart');
        if(!container || AppState.records.length === 0) return;
        
        const now = new Date();
        const oneYearAgo = DateUtil.addYearsClamped(now, -1);
        
        const deltaMap = {};
        let maxDelta = 0;
        let minDelta = 0;
        
        for(let i=1; i<AppState.records.length; i++) {
            const diff = AppState.records[i].weight - AppState.records[i-1].weight;
            deltaMap[AppState.records[i].date] = diff;
            if(diff > maxDelta) maxDelta = diff;
            if(diff < minDelta) minDelta = diff;
        }

        const dayCells = [];
        let cursor = new Date(oneYearAgo);
        cursor.setDate(cursor.getDate() - cursor.getDay());
        
        const endDate = new Date();
        
        while(cursor <= endDate) {
            const dStr = DateUtil.format(cursor);
            const val = deltaMap[dStr];
            
            let color = 'var(--heatmap-empty)';
            let title = dStr;
            
            if(val !== undefined) {
                title += ` (${val > 0 ? '+' : ''}${val.toFixed(1)}kg)`;
                if(val > 0) color = 'var(--heatmap-gain)';
                else if(val <= -1.0) color = 'var(--heatmap-4)';
                else if(val <= -0.5) color = 'var(--heatmap-3)';
                else if(val <= -0.2) color = 'var(--heatmap-2)';
                else if(val < 0) color = 'var(--heatmap-1)';
            }
            
            dayCells.push(`<div style="width:10px; height:10px; background:${color}; border-radius:2px;" title="${title}"></div>`);
            cursor.setDate(cursor.getDate() + 1);
        }
        
        let html = `<div style="
            display: grid; 
            grid-template-rows: repeat(7, 1fr); 
            grid-auto-flow: column; 
            gap: 2px; 
            overflow-x: auto;
            padding-bottom: 5px;
        ">`;
        html += dayCells.join('');
        html += '</div>';
        
        container.innerHTML = html;
    }

    // --- [NEW] 차트 추가: Goal Tunnel ---
    function updateGoalTunnelChart(colors) {
        if(AppState.records.length === 0) return;
        const ctx = document.getElementById('goalTunnelChart').getContext('2d');
        const data = getFilteredData();
        if(data.length === 0) return;
        const startRec = data[0];
        const endRec = data[data.length-1];
        
        const startDate = DateUtil.parse(startRec.date);
        const endDate = DateUtil.parse(endRec.date);
        const days = DateUtil.daysBetween(startDate, endDate) || 1;
        
        // Ideal slope: 0.75% of start weight per week (example)
        const weeklyLoss = startRec.weight * 0.0075;
        const dailyLoss = weeklyLoss / 7;
        
        const idealPoints = [];
        const upperPoints = [];
        const lowerPoints = [];
        
        for(let i=0; i<=days + 30; i++) { // Project 30 days ahead
            const d = new Date(startDate);
            d.setDate(d.getDate() + i);
            const idealW = startRec.weight - (dailyLoss * i);
            idealPoints.push({ x: d, y: idealW });
            upperPoints.push({ x: d, y: idealW + 1.5 }); // Tolerance band
            lowerPoints.push({ x: d, y: idealW - 1.5 });
        }
        
        const actualPoints = data.map(r => ({ x: r.date, y: r.weight }));
        
        const config = createChartConfig('line', {
            datasets: [
                {
                    label: '체중',
                    data: actualPoints,
                    borderColor: colors.text,
                    pointRadius: 2,
                    borderWidth: 2
                },
                {
                    label: '이상적 경로',
                    data: idealPoints,
                    borderColor: colors.secondary,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    borderWidth: 1
                },
                {
                    label: '허용 범위 상한',
                    data: upperPoints,
                    borderColor: 'transparent',
                    pointRadius: 0,
                    fill: '+1',
                    backgroundColor: 'rgba(33, 150, 243, 0.1)'
                },
                {
                    label: '허용 범위 하한',
                    data: lowerPoints,
                    borderColor: 'transparent',
                    pointRadius: 0
                }
            ]
        }, {
             scales: { x: { type: 'time', time: { unit: 'month' } } },
             plugins: { legend: { display: false } }
        }, colors);
        updateChartHelper('goalTunnel', ctx, config);
    }

    // --- [NEW] 차트 추가: Drawdown ---
    function updateDrawdownChart(colors) {
        if(AppState.records.length === 0) return;
        const ctx = document.getElementById('drawdownChart').getContext('2d');
        
        const data = [];
        let maxW = 0;
        
        AppState.records.forEach(r => {
            if(r.weight > maxW) maxW = r.weight;
            const dd = ((r.weight - maxW) / maxW) * 100;
            data.push({ x: r.date, y: dd });
        });
        
        const config = createChartConfig('line', {
            datasets: [{
                label: '하락률 (%)',
                data: data,
                borderColor: colors.danger,
                backgroundColor: 'rgba(244, 67, 54, 0.1)',
                fill: true,
                pointRadius: 0,
                borderWidth: 1
            }]
        }, {
             scales: { 
                 x: { type: 'time' },
                 y: { ticks: { callback: (v) => v + '%' } }
             },
             plugins: { legend: { display: false } }
        }, colors);
        updateChartHelper('drawdown', ctx, config);
    }

    // --- [NEW] 차트 추가: LBM vs Fat Area ---
    function updateLbmFatAreaChart(colors) {
        const fatRecs = AppState.records.filter(r => r.fat);
        if(fatRecs.length < 2) return;
        const ctx = document.getElementById('lbmFatAreaChart').getContext('2d');
        
        const lbmPct = fatRecs.map(r => ({ x: r.date, y: 100 - r.fat }));
        const fatPct = fatRecs.map(r => ({ x: r.date, y: r.fat }));
        
        const config = createChartConfig('line', {
            datasets: [
                {
                    label: '제지방 %',
                    data: lbmPct,
                    backgroundColor: colors.primary,
                    fill: true,
                    pointRadius: 0
                },
                {
                    label: '체지방 %',
                    data: fatPct,
                    backgroundColor: colors.danger,
                    fill: true,
                    pointRadius: 0
                }
            ]
        }, {
             scales: { 
                 x: { type: 'time' },
                 y: { stacked: true, max: 100 } 
             },
             plugins: { legend: { display: true } }
        }, colors);
        updateChartHelper('lbmFatArea', ctx, config);
    }

    // --- [NEW] 차트 추가: Speedometer ---
    function updateSpeedometerChart(colors) {
        const ctx = document.getElementById('speedometerChart').getContext('2d');
        const s = AppState.state.statsCache;
        if(!s || !s.rate7) return; 
        
        const recs = AppState.records.slice(-8);
        let weeklyRatePct = 0;
        if(recs.length >= 2) {
             const start = recs[0];
             const end = recs[recs.length-1];
             const days = DateUtil.daysBetween(DateUtil.parse(start.date), DateUtil.parse(end.date));
             if(days > 0) {
                 const loss = start.weight - end.weight;
                 const pct = (loss / start.weight) * 100;
                 weeklyRatePct = (pct / days) * 7;
             }
        }
        
        const val = Math.max(0, Math.min(weeklyRatePct, 2));
        
        const config = {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [0.5, 0.5, 1.0], 
                    backgroundColor: ['#e0e0e0', colors.primary, colors.danger],
                    borderWidth: 0
                }]
            },
            options: {
                circumference: 180,
                rotation: 270,
                cutout: '70%',
                responsive: true,
                plugins: {
                     tooltip: { enabled: false },
                     legend: { display: false }
                }
            },
            plugins: [{
                id: 'gaugeNeedle',
                afterDraw: (chart) => {
                     const { ctx, chartArea: { width, height } } = chart;
                     const cx = (chart.chartArea.left + chart.chartArea.right) / 2;
                     const cy = chart.chartArea.bottom; 
                     
                     const ratio = val / 2.0; 
                     const angle = Math.PI + (Math.PI * ratio);
                     
                     ctx.save();
                     ctx.translate(cx, cy - 20); 
                     ctx.rotate(angle);
                     ctx.beginPath();
                     ctx.moveTo(0, -5);
                     ctx.lineTo(height/1.5, 0);
                     ctx.lineTo(0, 5);
                     ctx.fillStyle = colors.text;
                     ctx.fill();
                     ctx.restore();
                     
                     ctx.font = "bold 16px sans-serif";
                     ctx.fillStyle = colors.text;
                     ctx.textAlign = "center";
                     ctx.fillText(weeklyRatePct.toFixed(2) + "% / 주", cx, cy);
                }
            }]
        };
        updateChartHelper('speedometer', ctx, config);
    }

    // --- 8. 테이블 & 히트맵 & 캘린더 & 뱃지 렌더링 (템플릿 사용 최적화) ---
    function renderHeatmap() {
        const container = AppState.getEl('heatmapGrid');
        if(AppState.records.length === 0) { container.innerHTML = ''; return; }

        const deltaMap = {};
        for(let i=1; i<AppState.records.length; i++) {
            const diff = MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight);
            deltaMap[AppState.records[i].date] = diff;
        }

        const end = new Date();
        const start = DateUtil.addYearsClamped(end, -1);
        
        const fragment = document.createDocumentFragment();
        const template = DomUtil.getTemplate('template-heatmap-cell');

        for(let d=start; d<=end; d.setDate(d.getDate()+1)) {
            const dateStr = DateUtil.format(d);
            const clone = template.content.cloneNode(true);
            const div = clone.querySelector('.heatmap-cell');
            
            let levelClass = 'level-0';
            let titleText = dateStr;

            if(deltaMap[dateStr] !== undefined) {
                const val = deltaMap[dateStr];
                titleText += ` (${val>0?'+':''}${val.toFixed(1)}kg)`;
                
                if(val > 0) levelClass = 'level-gain';
                else if(val > -0.2) levelClass = 'level-1'; 
                else if(val > -0.5) levelClass = 'level-2'; 
                else if(val > -1.0) levelClass = 'level-3'; 
                else levelClass = 'level-4'; 
            }
            
            div.classList.add(levelClass);
            div.title = titleText;
            fragment.appendChild(clone);
        }
        DomUtil.clearAndAppend(container, fragment);
    }

    function changeCalendarMonth(offset) {
        const d = AppState.state.calendarViewDate;
        AppState.state.calendarViewDate = new Date(d.getFullYear(), d.getMonth() + offset, 1);
        renderCalendarView();
    }

    function jumpToCalendarDate() {
        const year = parseInt(document.getElementById('calYearSelect').value);
        const month = parseInt(document.getElementById('calMonthSelect').value);
        AppState.state.calendarViewDate = new Date(year, month, 1);
        renderCalendarView();
    }

	function renderCalendarView() {
        const container = AppState.getEl('calendarContainer');
        if(AppState.records.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--text-light);">데이터가 없습니다.</p>';
            return;
        }
        
        const viewDate = AppState.state.calendarViewDate;
        const year = viewDate.getFullYear();
        const month = viewDate.getMonth();
        
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        
        const dayMap = {};
        AppState.records.forEach(r => {
            const rd = DateUtil.parse(r.date);
            if(rd.getFullYear() === year && rd.getMonth() === month) {
                dayMap[rd.getDate()] = r.weight;
            }
        });

        // [수정됨] onclick, onchange 제거 및 클래스 기반으로 변경
        let html = `<div class="calendar-header">
            <button class="cal-btn-prev">◀ 이전달</button>
            <div>
                <select id="calYearSelect">`;
        const currentYear = new Date().getFullYear();
        for(let y=currentYear-5; y<=currentYear+1; y++) {
            html += `<option value="${y}" ${y===year?'selected':''}>${y}년</option>`;
        }
        html += `</select>
                <select id="calMonthSelect">`;
        for(let m=0; m<12; m++) {
            html += `<option value="${m}" ${m===month?'selected':''}>${m+1}월</option>`;
        }
        html += `</select>
            </div>
            <button class="cal-btn-next">다음달 ▶</button>
        </div>`;
        
        html += `<div class="calendar-grid">`;
        
        const days = ['일','월','화','수','목','금','토'];
        days.forEach(d => html += `<div class="calendar-cell" style="font-weight:bold;background:var(--heatmap-empty);border:none;">${d}</div>`);
        
        for(let i=0; i<firstDay.getDay(); i++) html += `<div class="calendar-cell" style="background:transparent;border:none;"></div>`;
        
        for(let d=1; d<=lastDay.getDate(); d++) {
            const weight = dayMap[d];
            let cls = 'calendar-cell';
            let diffHtml = '';
            
            const currentDateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const targetIdx = AppState.records.findIndex(r => r.date === currentDateStr);
            
            if(targetIdx > 0 && AppState.records[targetIdx] && AppState.records[targetIdx-1]) {
                const currentW = AppState.records[targetIdx].weight;
                const prevW = AppState.records[targetIdx-1].weight;
                const diff = MathUtil.diff(currentW, prevW);
                if(diff > 0) cls += ' gain';
                if(diff < 0) cls += ' loss';
                diffHtml = `<div class="calendar-val">${diff>0?'+':''}${diff.toFixed(1)}</div>`;
            }

            html += `<div class="${cls}">
                <div class="calendar-date">${d}</div>
                <div class="calendar-val" style="font-weight:bold;">${weight ? weight : '-'}</div>
                ${diffHtml}
            </div>`;
        }
        html += `</div>`;
        container.innerHTML = html;
    }
		
    function renderAllTables() {
        renderMonthlyTable();
        renderWeeklyTable();
        renderMilestoneTable();
        renderHistoryTable();
    }
    
    function renderResistanceTable() {
        const resistance = {}; 
        const support = {};    
        
        for(let i=1; i<AppState.records.length-1; i++) {
            const prev = AppState.records[i-1].weight;
            const curr = AppState.records[i].weight;
            const next = AppState.records[i+1].weight;
            
            const zone = Math.floor(curr);
            
            if(curr > prev && curr > next) {
                if(!resistance[zone]) resistance[zone] = 0;
                resistance[zone]++;
            }
            if(curr < prev && curr < next) {
                if(!support[zone]) support[zone] = 0;
                support[zone]++;
            }
        }
        
        const sortedRes = Object.keys(resistance).sort((a,b)=>resistance[b]-resistance[a]).slice(0,3);
        const sortedSup = Object.keys(support).sort((a,b)=>support[b]-support[a]).slice(0,3);
        
        let html = '';
        sortedRes.forEach(z => html += `<tr><td>🔼 저항선 (High)</td><td>${z}kg대</td><td>${resistance[z]}회 반등</td></tr>`);
        sortedSup.forEach(z => html += `<tr><td>🔽 지지선 (Low)</td><td>${z}kg대</td><td>${support[z]}회 지지</td></tr>`);
        
        if(!html) html = '<tr><td colspan="3">데이터 부족</td></tr>';
        
        const tbody = AppState.getEl('resistanceTableBody');
        if(tbody) tbody.innerHTML = html;
    }

    function renderWeekdayProbTable() {
        const gainCounts = [0,0,0,0,0,0,0];
        const totalCounts = [0,0,0,0,0,0,0];
        const dayNames = ['일','월','화','수','목','금','토'];
        
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date).getDay();
            const diff = AppState.records[i].weight - AppState.records[i-1].weight;
            totalCounts[d]++;
            if(diff > 0) gainCounts[d]++;
        }
        
        let html = '';
        dayNames.forEach((name, i) => {
            if(totalCounts[i] > 0) {
                const prob = Math.round((gainCounts[i] / totalCounts[i]) * 100);
                let risk = '';
                if(prob >= 60) risk = '<span class="text-danger">높음</span>';
                else if(prob <= 30) risk = '<span class="text-primary">낮음</span>';
                else risk = '보통';
                
                html += `<tr><td>${name}요일</td><td>${prob}%</td><td>${risk}</td></tr>`;
            }
        });
        
        if(!html) html = '<tr><td colspan="3">데이터 부족</td></tr>';
        
        const tbody = AppState.getEl('weekdayProbTableBody');
        if(tbody) tbody.innerHTML = html;
    }

    function renderNewTables() {
        if(AppState.records.length < 2) return;

        const zones = {};
        for(let i=1; i<AppState.records.length; i++) {
            const z = Math.floor(AppState.records[i].weight / 10) * 10;
            const key = z;
            if(!zones[key]) zones[key] = { days: 0, startDate: AppState.records[i].date, endDate: AppState.records[i].date };
            zones[key].days++;
            if(AppState.records[i].date > zones[key].endDate) zones[key].endDate = AppState.records[i].date;
        }
        let zRows = [];
        Object.keys(zones).sort().reverse().forEach(z => {
            const d = zones[z];
            const escapeTime = DateUtil.daysBetween(DateUtil.parse(d.startDate), DateUtil.parse(d.endDate));
            zRows.push(`<tr><td>${z}kg대</td><td>${d.days}일</td><td>${escapeTime}일</td></tr>`);
        });
        AppState.getEl('zoneReportTableBody').innerHTML = zRows.join('');

        const sprints = [];
        for(let i=0; i<AppState.records.length; i++) {
            const startW = AppState.records[i].weight;
            for(let j=i+1; j<Math.min(i+30, AppState.records.length); j++) {
                if(startW - AppState.records[j].weight >= 1.0) {
                    const days = DateUtil.daysBetween(DateUtil.parse(AppState.records[i].date), DateUtil.parse(AppState.records[j].date));
                    sprints.push({ days, start: AppState.records[i].date, end: AppState.records[j].date, loss: startW - AppState.records[j].weight });
                    break; 
                }
            }
        }
        sprints.sort((a,b) => a.days - b.days);
        const top5 = sprints.slice(0, 5);
        let sRows = top5.map((s, i) => `<tr><td>${i+1}위</td><td>${s.loss.toFixed(1)}kg</td><td>${s.days}일</td><td>${s.start}~${s.end}</td></tr>`);
        AppState.getEl('sprintTableBody').innerHTML = sRows.length ? sRows.join('') : '<tr><td colspan="4">데이터 부족</td></tr>';

        const dayWin = [0,0,0,0,0,0,0], dayTot = [0,0,0,0,0,0,0];
        const dayLoss = [0,0,0,0,0,0,0];
        const dayNames = ['일','월','화','수','목','금','토'];
        
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date).getDay();
            const diff = AppState.records[i].weight - AppState.records[i-1].weight;
            dayTot[d]++;
            dayLoss[d] += diff;
            if(diff < 0) dayWin[d]++;
        }
        
        let gRows = [];
        dayNames.forEach((n, i) => {
            if(dayTot[i] > 0) {
                const avg = dayLoss[i] / dayTot[i];
                const win = (dayWin[i] / dayTot[i] * 100).toFixed(0);
                const winRate = Number(win);
                let grade = 'C';
                if(avg < -0.2 && winRate > 60) grade = 'A';
                else if(avg < 0) grade = 'B';
                else if(avg > 0.5) grade = 'F';
                else if(avg > 0.2) grade = 'D';
                
                gRows.push(`<tr><td>${n}요일</td><td>${avg.toFixed(2)}</td><td>${win}%</td><td>${grade}</td></tr>`);
            }
        });
        AppState.getEl('gradesTableBody').innerHTML = gRows.join('');
        
        renderTop5Table();
        renderMonthlyRateTable();
    }
    
    function renderTop5Table() {
        const drops = [], gains = [];
        let maxStreak = 0, curStreak = 0;
        
        for(let i=1; i<AppState.records.length; i++) {
             const diff = AppState.records[i].weight - AppState.records[i-1].weight;
             if(diff < 0) {
                 drops.push({ date: AppState.records[i].date, val: diff });
                 if (isNextCalendarDay(AppState.records[i-1], AppState.records[i])) {
                     curStreak++;
                 } else {
                     if(curStreak > maxStreak) maxStreak = curStreak;
                     curStreak = 0;
                 }
             } else {
                 gains.push({ date: AppState.records[i].date, val: diff });
                 if(curStreak > maxStreak) maxStreak = curStreak;
                 curStreak = 0;
             }
        }
        if(curStreak > maxStreak) maxStreak = curStreak;
        
        drops.sort((a,b) => a.val - b.val);
        gains.sort((a,b) => b.val - a.val); 
        
        const topDrops = drops.slice(0, 5);
        const topGains = gains.slice(0, 5);
        
        let html = '';
        for(let i=0; i<5; i++) {
            html += `<tr>
                <td>${i+1}위</td>
                <td>${topDrops[i] ? topDrops[i].date + ' (' + topDrops[i].val.toFixed(1) + 'kg)' : '-'}</td>
                <td>${topGains[i] ? topGains[i].date + ' (+' + topGains[i].val.toFixed(1) + 'kg)' : '-'}</td>
                <td>${i===0 ? maxStreak + '일 연속' : '-'}</td>
            </tr>`;
        }
        AppState.getEl('top5TableBody').innerHTML = html;
    }

    function renderMonthlyRateTable() {
        const months = {};
        AppState.records.forEach((r, i) => {
            if(i===0) return;
            const k = r.date.substring(0, 7);
            if(!months[k]) months[k] = { success: 0, total: 0 };
            const diff = r.weight - AppState.records[i-1].weight;
            months[k].total++;
            if(diff < 0) months[k].success++;
        });
        
        let html = '';
        Object.keys(months).sort().reverse().forEach(m => {
            const d = months[m];
            const rate = d.total > 0 ? ((d.success / d.total) * 100).toFixed(0) : 0;
            html += `<tr><td>${m}</td><td>${d.success}일</td><td>${d.total}일</td><td>${rate}%</td></tr>`;
        });
        AppState.getEl('monthlyRateTableBody').innerHTML = html;
    }

    function renderMonthlyTable() {
        const months = {};
        AppState.records.forEach(r => {
            const key = r.date.substring(0, 7);
            if(!months[key]) months[key] = [];
            months[key].push(r.weight);
        });
        
        let rows = [];
        Object.keys(months).sort().reverse().forEach(m => {
            const arr = months[m];
            const start = arr[0];
            const end = arr[arr.length-1];
            const diff = MathUtil.diff(end, start);
            const avg = (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1);
            rows.push(`<tr><td>${DomUtil.escapeHtml(m)}</td><td>${start}</td><td>${end}</td><td class="${diff<=0?'neg':'pos'}">${diff}</td><td>${avg}</td></tr>`);
        });
        AppState.getEl('monthlyTableBody').innerHTML = rows.join('');
    }

    function renderWeeklyTable() {
        const weeks = {};
        AppState.records.forEach(r => {
            const d = DateUtil.parse(r.date);
            const day = d.getDay(), diff = d.getDate() - day + (day == 0 ? -6:1); 
            const monday = new Date(d.setDate(diff));
            const key = DateUtil.format(monday);
            
            if(!weeks[key]) weeks[key] = [];
            weeks[key].push(r.weight);
        });

        let rows = [];
        Object.keys(weeks).sort().reverse().forEach(w => {
            const arr = weeks[w];
            const avg = (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1);
            const diff = MathUtil.diff(arr[arr.length-1], arr[0]);
            rows.push(`<tr><td>${DomUtil.escapeHtml(w)} 주</td><td>${avg}kg</td><td class="${diff<=0?'neg':'pos'}">${diff}</td></tr>`);
        });
        AppState.getEl('weeklyTableBody').innerHTML = rows.join('');
    }

    function renderMilestoneTable() {
        let rows = [];
        if(AppState.records.length > 0) {
            let currentInt = Math.floor(AppState.records[0].weight);
            let startDate = DateUtil.parse(AppState.records[0].date);
            
            for(let i=1; i<AppState.records.length; i++) {
                const w = Math.floor(AppState.records[i].weight);
                if(w < currentInt) {
                    const nowD = DateUtil.parse(AppState.records[i].date);
                    const days = Math.ceil((nowD - startDate)/(1000*3600*24));
                    rows.push(`<tr><td>🎉 ${w}kg대 진입</td><td>${DomUtil.escapeHtml(AppState.records[i].date)}</td><td>${days}일 소요</td></tr>`);
                    currentInt = w;
                    startDate = nowD;
                }
            }
        }
        AppState.getEl('milestoneTableBody').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="3">아직 기록된 마일스톤이 없습니다.</td></tr>';
    }

    let inlineEditDraftStorageWarningShown = false;

    function persistInlineEditDraftToSession() {
        if (typeof sessionStorage === 'undefined') return;

        try {
            const draft = AppState.state.inlineEditDraft;
            if (draft) sessionStorage.setItem(AppState.INLINE_EDIT_DRAFT_KEY, JSON.stringify(draft));
            else sessionStorage.removeItem(AppState.INLINE_EDIT_DRAFT_KEY);
        } catch (error) {
            if (!inlineEditDraftStorageWarningShown) {
                console.warn('Diet inline edit draft could not be stored for this session.', error);
                inlineEditDraftStorageWarningShown = true;
            }
        }
    }

    function setInlineEditDraft(draft) {
        AppState.state.inlineEditDraft = draft;
        persistInlineEditDraftToSession();
    }

    function clearInlineEditDraft() {
        setInlineEditDraft(null);
    }

    function restoreInlineEditDraftFromSession() {
        // 체중 기록 원본을 읽지 못한 보호 상태에서는, 원본이 없는 것으로 오인해
        // 세션 초안까지 삭제하지 않습니다.
        if (AppState.state.recordsLoadFailed || typeof sessionStorage === 'undefined') return;

        try {
            const storedDraft = sessionStorage.getItem(AppState.INLINE_EDIT_DRAFT_KEY);
            if (!storedDraft) return;

            const parsedDraft = JSON.parse(storedDraft);
            const date = String(parsedDraft?.date ?? '');
            const weight = parsedDraft?.weight;
            const fat = parsedDraft?.fat;
            const sourceWeight = Number(parsedDraft?.sourceWeight);
            const hasSourceFat = parsedDraft?.sourceFat !== null;
            const sourceFat = hasSourceFat ? Number(parsedDraft?.sourceFat) : null;
            const hasScalarDraftValues = (typeof weight === 'string' || typeof weight === 'number')
                && (typeof fat === 'string' || typeof fat === 'number');

            if (!DateUtil.isValidDateString(date)
                || !hasScalarDraftValues
                || String(weight).length > 64
                || String(fat).length > 64
                || !Number.isFinite(sourceWeight)
                || (hasSourceFat && !Number.isFinite(sourceFat))) {
                throw new Error('Invalid inline edit draft structure.');
            }

            const normalizedDraft = {
                date,
                weight: String(weight),
                fat: String(fat),
                sourceWeight,
                sourceFat
            };
            const sourceRecord = AppState.records.find(record => record.date === date);
            if (!isInlineEditSourceUnchanged(normalizedDraft, sourceRecord)) {
                clearInlineEditDraft();
                return;
            }

            AppState.state.inlineEditDraft = normalizedDraft;
        } catch (error) {
            console.warn('Invalid diet inline edit draft was discarded.', error);
            clearInlineEditDraft();
        }
    }

    function captureInlineEditDraftFromDom() {
        const draft = AppState.state.inlineEditDraft;
        if (!draft || !DateUtil.isValidDateString(draft.date)) return;

        const weightInput = document.getElementById(`inline-weight-${draft.date}`);
        const fatInput = document.getElementById(`inline-fat-${draft.date}`);
        if (weightInput) draft.weight = weightInput.value;
        if (fatInput) draft.fat = fatInput.value;
        if (weightInput || fatInput) persistInlineEditDraftToSession();
    }

    function isInlineEditSourceUnchanged(draft, record) {
        if (!draft || !record) return false;
        const recordFat = Object.prototype.hasOwnProperty.call(record, 'fat') ? record.fat : null;
        return record.weight === draft.sourceWeight && recordFat === draft.sourceFat;
    }

    function applyInlineEditDraftToRow({ focusField = null } = {}) {
        const draft = AppState.state.inlineEditDraft;
        if (!draft || !DateUtil.isValidDateString(draft.date)) return false;

        const record = AppState.records.find(item => item.date === draft.date);
        if (!isInlineEditSourceUnchanged(draft, record)) {
            clearInlineEditDraft();
            if (record) showToast('원본 기록이 변경되어 오래된 인라인 편집을 취소했습니다.');
            return false;
        }

        const safeDateSelector = escapeCssAttributeValue(draft.date);
        const btn = document.querySelector(`button[data-date="${safeDateSelector}"][data-action="edit"]`);
        const tr = btn?.closest('tr');
        if (!tr || tr.cells.length < 5) return false;

        const createInput = (field, value, step) => {
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'inline-input';
            input.id = `inline-${field}-${draft.date}`;
            input.dataset.inlineField = field;
            input.dataset.date = draft.date;
            input.step = step;
            input.value = value;
            return input;
        };

        const weightInput = createInput('weight', draft.weight, '0.1');
        const fatInput = createInput('fat', draft.fat, '0.1');
        tr.cells[1].replaceChildren(weightInput);
        tr.cells[2].replaceChildren(fatInput);
        tr.cells[3].textContent = '-';

        const saveButton = document.createElement('button');
        saveButton.dataset.action = 'save-inline';
        saveButton.dataset.date = draft.date;
        saveButton.className = 'inline-btn';
        saveButton.title = '저장';
        saveButton.textContent = '💾';

        const cancelButton = document.createElement('button');
        cancelButton.dataset.action = 'cancel-inline';
        cancelButton.className = 'inline-btn';
        cancelButton.title = '취소';
        cancelButton.textContent = '❌';
        tr.cells[4].replaceChildren(saveButton, cancelButton);

        if (focusField === 'weight') weightInput.focus();
        if (focusField === 'fat') fatInput.focus();
        return true;
    }

    function renderHistoryTable() {
        const container = AppState.getEl('historyList');
        const template = DomUtil.getTemplate('template-history-row');
        const fragment = document.createDocumentFragment();

        const rev = [...AppState.records].reverse();
        rev.forEach(r => {
            const idx = AppState.records.findIndex(o => o.date === r.date);
            let diffStr = '-';
            let cls = '';
            if(idx > 0) {
                const d = MathUtil.diff(r.weight, AppState.records[idx-1].weight);
                diffStr = (d>0?'+':'') + d.toFixed(1);
                cls = d>0?'pos':(d<0?'neg':'');
            }
            const fatStr = r.fat ? r.fat + '%' : '-';
            
            const clone = template.content.cloneNode(true);
            clone.querySelector('.history-date').textContent = r.date;
            clone.querySelector('.history-weight').textContent = r.weight + 'kg';
            clone.querySelector('.history-fat').textContent = fatStr;
            const diffCell = clone.querySelector('.history-diff');
            diffCell.textContent = diffStr;
            if(cls) diffCell.classList.add(cls);

            const btnEdit = clone.querySelector('button[data-action="edit"]');
            btnEdit.dataset.date = r.date;
            const btnDelete = clone.querySelector('button[data-action="delete"]');
            btnDelete.dataset.date = r.date;

            fragment.appendChild(clone);
        });
        DomUtil.clearAndAppend(container, fragment);
        applyInlineEditDraftToRow();
    }

	function renderBadges(s) {
        if(AppState.records.length === 0) return;
        const totalLost = MathUtil.diff(AppState.settings.startWeight, s.current);
        const streak = s.maxStreak || 0;
        const longestRecordingRun = getLongestConsecutiveRecordRun(AppState.records);

        const flags = {
            weekendDef: false,
            plateauBreak: false,
            bmiBreak: false,
            yoyoPrev: false,
            ottogi: false,
            recordGod: AppState.records.length >= 365,
            goldenCross: false,
            fatDestroyer: false,
            holidaySurvivor: false,
            returnProdigal: false,
            sniper: false,
            rollerCoaster: false,
            equanimity: false,
            plateauMaster: false,
            recordMaster: false,
            reborn: false,
            slowSteady: false,
            weightExpert: false,
            plateauDestroyer: false, 
            iconOfConstancy: false,
            bigStep: false,
            phoenix: false,
            weekendRuler: false,
            curiosity: false,
            timeTraveler: false,
            parking: false,
            whoosh: false,
            fullMoon: false,
            lucky7: false,
            ironWall: false,
            seasonality: false,
            decalcomania: false,
            cleaning: false,
            gyroDrop: false,
            weekendSniper: false,
            piMiracle: false,
            palindrome: false,
            anniversary: false,
            // v3.0.71 추가 Flags
            breakMaster: false,
            weekendVictory: false,
            maintainerQual: false,
            wallBreaker: false
        };

        if(AppState.records.length > 1) {
            if(Math.abs(s.current - AppState.settings.goal1) < 0.01) flags.sniper = true;

            for(let i=1; i<AppState.records.length; i++) {
                const diff = Math.abs(MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight));
                if(diff >= 1.5) {
                    const days = DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date));
                    if(days === 1) { flags.rollerCoaster = true; break; }
                }
            }

            if(AppState.records.length >= 7) {
                for(let i=6; i<AppState.records.length; i++) {
                    const slice = AppState.records.slice(i-6, i+1);
                    const diffs = [];
                    for(let j=1; j<slice.length; j++) diffs.push(Math.abs(slice[j].weight - slice[j-1].weight));
                    if(isConsecutiveDailyRecordRange(slice) && diffs.every(d => d <= 0.1)) { flags.equanimity = true; break; }
                }
            }

            for(let i=1; i<AppState.records.length; i++) {
                const days = DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date));
                if(days >= 15) { flags.returnProdigal = true; break; }
            }

            const holidays = ['12-25', '01-01', '01-29', '10-06']; 
            holidays.forEach(h => {
                const year = new Date().getFullYear();
                const hDate = DateUtil.parse(`${year}-${h}`);
                const around = AppState.records.filter(r => {
                    const rd = DateUtil.parse(r.date);
                    return Math.abs(DateUtil.daysBetween(rd, hDate)) <= 3;
                });
                if(around.length >= 2) {
                    const gain = around[around.length-1].weight - around[0].weight;
                    if(gain < 0.5) flags.holidaySurvivor = true;
                }
            });

            for(let i=0; i<AppState.records.length-1; i++) {
                const d1 = DateUtil.parse(AppState.records[i].date);
                if(d1.getDay() === 6) { 
                    const next = AppState.records.find(r => r.date > AppState.records[i].date); 
                    if(next && DateUtil.parse(next.date).getDay() === 1 && next.weight <= AppState.records[i].weight) {
                        flags.weekendDef = true; break;
                    }
                }
            }
            
            flags.plateauBreak = hasConsecutivePlateauBreak(AppState.records, 7);

            const h = AppState.settings.height / 100;
            const bmiStart = AppState.settings.startWeight / (h*h);
            const bmiCurr = s.current / (h*h);
            const getCat = (b) => {
                if(b < CONFIG.BMI.UNDER) return 'Under';
                if(b < CONFIG.BMI.NORMAL_END) return 'Normal';
                if(b < CONFIG.BMI.PRE_OBESE_END) return 'PreObese';
                if(b < CONFIG.BMI.OBESE_1_END) return 'Obese1';
                if(b < CONFIG.BMI.OBESE_2_END) return 'Obese2';
                return 'Obese3';
            };
            if(getCat(bmiStart) !== getCat(bmiCurr)) flags.bmiBreak = true;

            if(s.current <= AppState.settings.goal1) {
                const recent = AppState.records.slice(-10);
                if(recent.length >= 10
                    && isConsecutiveDailyRecordRange(recent)
                    && recent.every(r => Math.abs(r.weight - AppState.settings.goal1) <= 0.5)) flags.yoyoPrev = true;
            }

            for(let i=1; i<AppState.records.length; i++) {
                if(!isNextCalendarDay(AppState.records[i-1], AppState.records[i])
                    || MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight) < 0.5) continue;

                for (let j=i+1; j<AppState.records.length; j++) {
                    const recoveryDays = DateUtil.daysBetween(
                        DateUtil.parse(AppState.records[i].date),
                        DateUtil.parse(AppState.records[j].date)
                    );
                    if (recoveryDays > 3) break;
                    if (recoveryDays > 0 && AppState.records[j].weight <= AppState.records[i-1].weight) {
                        flags.ottogi = true;
                        break;
                    }
                }
                if (flags.ottogi) break;
            }

            if(AppState.records.length > 30) {
                const last7 = AppState.records.slice(-7).reduce((a,b)=>a+b.weight,0)/7;
                const last30 = AppState.records.slice(-30).reduce((a,b)=>a+b.weight,0)/30;
                if(last7 < last30 - 0.5) flags.goldenCross = true;
            }

            if(s.lastRec && s.lastRec.fat && s.lastRec.fat < 25) { 
                flags.fatDestroyer = true;
            }

            flags.plateauMaster = hasConsecutivePlateauBreak(AppState.records, 7, 0.5);

            if(longestRecordingRun >= 90) flags.recordMaster = true;

            if(s.max - s.current >= 10) flags.reborn = true;

            if(AppState.records.length >= 90) {
                const threeMonthsAgo = DateUtil.addMonthsClamped(new Date(), -3);
                const recs = AppState.records.filter(r => DateUtil.parse(r.date) >= threeMonthsAgo);
                if(recs.length > 0) {
                    const loss = MathUtil.diff(recs[0].weight, s.current);
                    const avgLoss = loss / 3;
                    if(avgLoss > 0 && avgLoss <= 2) flags.slowSteady = true;
                }
            }

            if(AppState.records.length >= 30) {
                const oneMonthAgo = DateUtil.addMonthsClamped(new Date(), -1);
                const rec = AppState.records.find(r => DateUtil.parse(r.date) >= oneMonthAgo);
                if(rec && (rec.weight - s.current >= 4)) flags.weightExpert = true;
            }

            flags.plateauDestroyer = hasConsecutivePlateauBreak(AppState.records, 14, 0.2);

            if(longestRecordingRun >= 180) flags.iconOfConstancy = true;

            for(let i=1; i<AppState.records.length; i++) {
                const days = DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date));
                if(days === 1 && AppState.records[i-1].weight - AppState.records[i].weight >= 1.0) {
                    flags.bigStep = true; break;
                }
            }

            let localMin = 999;
            let rebound = false;
            for(let i=0; i<AppState.records.length-1; i++) {
                if(AppState.records[i].weight < localMin) localMin = AppState.records[i].weight;
                if(localMin < 900 && AppState.records[i].weight > localMin + 3.0) rebound = true;
            }
            if(rebound && s.current < localMin) flags.phoenix = true;

            for(let i=0; i<AppState.records.length; i++) {
                 const d = DateUtil.parse(AppState.records[i].date);
                 if(d.getDay() === 1) { 
                     const prevFriDate = new Date(d); prevFriDate.setDate(d.getDate()-3);
                     const prevFriStr = DateUtil.format(prevFriDate);
                     const friRec = AppState.records.find(r => r.date === prevFriStr);
                     if(friRec && AppState.records[i].weight < friRec.weight) {
                         flags.weekendRuler = true; break;
                     }
                 }
            }

            let noFatStreak = 0;
            for(let i=0; i<AppState.records.length; i++) {
                if(!AppState.records[i].fat) noFatStreak++;
                else {
                    if(noFatStreak >= 10) { 
                        const recordedStreak = [];
                        for(let j=i; j<Math.min(i+10, AppState.records.length); j++) {
                            if(AppState.records[j].fat) recordedStreak.push(AppState.records[j]);
                            else break;
                        }
                        if(recordedStreak.length >= 10 && isConsecutiveDailyRecordRange(recordedStreak)) {
                            flags.curiosity = true;
                            break;
                        }
                    }
                    noFatStreak = 0;
                }
            }

            const rem = s.current - AppState.settings.goal1;
            if(rem > 0 && AppState.records.length > 30) {
                const totalDays = DateUtil.daysBetween(DateUtil.parse(AppState.records[0].date), DateUtil.parse(s.lastRec.date));
                const totalSpeed = (AppState.records[0].weight - s.current) / totalDays;
                
                const recentRec = AppState.records[AppState.records.length-15]; 
                if(recentRec) {
                    const recentDays = DateUtil.daysBetween(DateUtil.parse(recentRec.date), DateUtil.parse(s.lastRec.date));
                    const recentSpeed = (recentRec.weight - s.current) / recentDays;
                    
                    if(totalSpeed > 0 && recentSpeed > 0) {
                        const daysTotal = rem / totalSpeed;
                        const daysRecent = rem / recentSpeed;
                        if(daysTotal - daysRecent >= 10) flags.timeTraveler = true;
                    }
                }
            }

            if(AppState.records.length >= 14) {
                 const recs14 = AppState.records.slice(-14);
                 const w14 = recs14.map(r => r.weight);
                 if(isConsecutiveDailyRecordRange(recs14) && Math.max(...w14) - Math.min(...w14) <= 0.6) flags.parking = true;
            }

            flags.whoosh = hasConsecutivePlateauBreak(AppState.records, 4, 0.8);

            if(longestRecordingRun >= 30) flags.fullMoon = true;

            if(s.current.toString().endsWith('.7') || s.current.toString().endsWith('.77')) flags.lucky7 = true;

            if(s.max - s.current >= 0.5) { 
                for(let i=1; i<AppState.records.length; i++) {
                     if(Math.abs(AppState.records[i].weight - s.max) < 0.5 && AppState.records[i].weight > AppState.records[i+1].weight) {
                         flags.ironWall = true; break;
                     }
                }
            }

            const seasons = new Set();
            AppState.records.forEach(r => {
                const m = DateUtil.parse(r.date).getMonth() + 1;
                if(m===3) seasons.add('Spring');
                if(m===6) seasons.add('Summer');
                if(m===9) seasons.add('Autumn');
                if(m===12) seasons.add('Winter');
            });
            if(seasons.size === 4) flags.seasonality = true;

            for(let i=1; i<AppState.records.length; i++) {
                if(AppState.records[i].weight === AppState.records[i-1].weight &&
                   DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date)) === 1) {
                    flags.decalcomania = true; break;
                }
            }

            if(s.fatChange < 0 && s.fatChange < totalLost * -1) flags.cleaning = true; 

            for(let i=1; i<AppState.records.length; i++) {
                if(AppState.records[i-1].weight - AppState.records[i].weight >= 1.0 && 
                   DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date)) === 1) {
                    flags.gyroDrop = true; break;
                }
            }

            for(let i=0; i<AppState.records.length; i++) {
                 const d = DateUtil.parse(AppState.records[i].date);
                 if(d.getDay() === 1) { 
                     const prevFriDate = new Date(d); prevFriDate.setDate(d.getDate()-3);
                     const prevFriStr = DateUtil.format(prevFriDate);
                     const friRec = AppState.records.find(r => r.date === prevFriStr);
                     if(friRec && AppState.records[i].weight < friRec.weight) {
                         flags.weekendSniper = true; break;
                     }
                 }
            }

            if(Math.abs(totalLost - 3.14) < 0.05 || s.current.toString().endsWith('.14') || s.current.toString().endsWith('3.14')) {
                flags.piMiracle = true;
            }

            if (s.current.toString() === s.current.toString().split('').reverse().join('')) {
                flags.palindrome = true;
            }
            
            const totalDays = DateUtil.daysBetween(DateUtil.parse(AppState.records[0].date), DateUtil.parse(AppState.records[AppState.records.length-1].date)) + 1;
            if (totalDays === 100 || totalDays === 365 || totalDays === 1000) {
                flags.anniversary = true;
            }

            // v3.0.71 추가 Flags Logic
            
            // Break Master
            for(let i=1; i<AppState.records.length-1; i++) {
                const surge = AppState.records[i].weight - AppState.records[i-1].weight;
                if(surge >= 0.5
                    && isNextCalendarDay(AppState.records[i-1], AppState.records[i])
                    && isNextCalendarDay(AppState.records[i], AppState.records[i+1])) {
                    const next = AppState.records[i+1].weight;
                    const recovery = AppState.records[i].weight - next;
                    if(recovery >= surge * 0.5) { flags.breakMaster = true; break; }
                }
            }
            
            // Weekend Victory
            for(let i=1; i<AppState.records.length; i++) {
                 const d = DateUtil.parse(AppState.records[i].date);
                 if(d.getDay() === 1) { 
                     const prevFriDate = new Date(d); prevFriDate.setDate(d.getDate()-3);
                     const prevFriStr = DateUtil.format(prevFriDate);
                     const friRec = AppState.records.find(r => r.date === prevFriStr);
                     if(friRec && AppState.records[i].weight <= friRec.weight) {
                         flags.weekendVictory = true; break;
                     }
                 }
            }

            // Maintainer Qual
            if(AppState.records.length >= 10) {
                for(let i=9; i<AppState.records.length; i++) {
                    const recordSlice = AppState.records.slice(i-9, i+1);
                    const weightSlice = recordSlice.map(r=>r.weight);
                    const maxS = Math.max(...weightSlice);
                    const minS = Math.min(...weightSlice);
                    if(isConsecutiveDailyRecordRange(recordSlice) && maxS - minS <= 0.4) { flags.maintainerQual = true; break; }
                }
            }
            
            // Wall Breaker
            const zoneCounts = {};
            AppState.records.forEach(r => {
                const z = Math.floor(r.weight);
                if(!zoneCounts[z]) zoneCounts[z] = 0;
                zoneCounts[z]++;
            });
            const frequentZone = Object.keys(zoneCounts).sort((a,b)=>zoneCounts[b]-zoneCounts[a])[0];
            if(frequentZone && s.current < parseInt(frequentZone)) flags.wallBreaker = true;

        }

        const badgeConditions = {
            start: AppState.records.length >= 1,
            holiday: flags.holidaySurvivor,
            zombie: flags.returnProdigal,
            sniper: flags.sniper,
            coaster: flags.rollerCoaster,
            zen: flags.equanimity,
            loss3: totalLost >= 3,
            loss5: totalLost >= 5,
            loss10: totalLost >= 10,
            streak3: streak >= 3,
            streak7: streak >= 7,
            digit: Math.floor(s.current/10) < Math.floor(AppState.settings.startWeight/10),
            goal: s.current <= AppState.settings.goal1,
            weekend: flags.weekendDef,
            plateau: flags.plateauBreak,
            bmi: flags.bmiBreak,
            yoyo: flags.yoyoPrev,
            ottogi: flags.ottogi,
            recordGod: flags.recordGod,
            goldenCross: flags.goldenCross,
            fatDestroyer: flags.fatDestroyer,
            plateauMaster: flags.plateauMaster,
            recordMaster: flags.recordMaster,
            reborn: flags.reborn,
            slowSteady: flags.slowSteady,
            weightExpert: flags.weightExpert,
            plateauDestroyer: flags.plateauDestroyer,
            iconOfConstancy: flags.iconOfConstancy,
            bigStep: flags.bigStep,
            phoenix: flags.phoenix,
            weekendRuler: flags.weekendRuler,
            curiosity: flags.curiosity,
            timeTraveler: flags.timeTraveler,
            parking: flags.parking,
            whoosh: flags.whoosh,
            fullMoon: flags.fullMoon,
            lucky7: flags.lucky7,
            ironWall: flags.ironWall,
            seasonality: flags.seasonality,
            decalcomania: flags.decalcomania,
            cleaning: flags.cleaning,
            gyroDrop: flags.gyroDrop,
            weekendSniper: flags.weekendSniper,
            piMiracle: flags.piMiracle,
            palindrome: flags.palindrome,
            anniversary: flags.anniversary,
            // v3.0.71 추가 Badge conditions
            breakMaster: flags.breakMaster,
            weekendVictory: flags.weekendVictory,
            maintainerQual: flags.maintainerQual,
            wallBreaker: flags.wallBreaker
        };

        const container = AppState.getEl('badgeGrid');
        const template = DomUtil.getTemplate('template-badge-item');
        const fragment = document.createDocumentFragment();

        CONFIG.BADGES.forEach(b => {
            const isUnlocked = badgeConditions[b.id];
            
            const clone = template.content.cloneNode(true);
            const item = clone.querySelector('.badge-item');
            
            if(isUnlocked) item.classList.add('unlocked');
            item.title = `${b.desc} (${isUnlocked ? '획득 완료' : '미획득'})`;
            clone.querySelector('.badge-icon').textContent = b.icon;
            clone.querySelector('.badge-name').textContent = b.name;
            
            fragment.appendChild(clone);
        });
        DomUtil.clearAndAppend(container, fragment);
    }
	
	
    function switchTab(tabId) {
        document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
        AppState.getEl(tabId).style.display = 'block';
        
        document.querySelectorAll('.filter-group button[id^="tab-btn"]').forEach(b => b.classList.remove('active'));
        if(tabId.includes('monthly') && !tabId.includes('rate')) AppState.getEl('tab-btn-monthly').classList.add('active');
        if(tabId.includes('weekly')) AppState.getEl('tab-btn-weekly').classList.add('active');
        if(tabId.includes('milestone')) AppState.getEl('tab-btn-milestone').classList.add('active');
        if(tabId.includes('history')) AppState.getEl('tab-btn-history').classList.add('active');
        if(tabId.includes('zone')) AppState.getEl('tab-btn-zone').classList.add('active');
        if(tabId.includes('sprint')) AppState.getEl('tab-btn-sprint').classList.add('active');
        if(tabId.includes('grades')) AppState.getEl('tab-btn-grades').classList.add('active');
        if(tabId.includes('top5')) AppState.getEl('tab-btn-top5').classList.add('active');
        if(tabId.includes('monthly-rate')) AppState.getEl('tab-btn-monthly-rate').classList.add('active');
    }

    function toggleChartExpand(btn) {
        const card = btn.closest('.card');
        const backdrop = AppState.getEl('chartBackdrop');
        const isExpanded = card.classList.contains('expanded-card');

        if (!isExpanded) {
            closeAllExpands();
        }

        card.classList.toggle('expanded-card');
        
        if (card.classList.contains('expanded-card')) {
            btn.innerText = '✖'; 
            btn.style.color = 'var(--danger)';
            backdrop.classList.add('active');
            document.body.style.overflow = 'hidden'; 
        } else {
            btn.innerText = '⛶'; 
            btn.style.color = '';
            backdrop.classList.remove('active');
            document.body.style.overflow = '';
        }

        setTimeout(() => {
            const canvas = card.querySelectorAll('canvas');
            canvas.forEach(cvs => {
                const chartInstance = Chart.getChart(cvs);
                if(chartInstance) chartInstance.resize();
            });
        }, 50);
    }

    function closeAllExpands() {
        const expandedCards = document.querySelectorAll('.expanded-card');
        const backdrop = AppState.getEl('chartBackdrop');
        
        expandedCards.forEach(card => {
            card.classList.remove('expanded-card');
            const btn = card.querySelector('.expand-btn');
            if(btn) {
                btn.innerText = '⛶';
                btn.style.color = '';
            }
        });
        
        if(backdrop) backdrop.classList.remove('active');
        document.body.style.overflow = '';
        
        setTimeout(() => {
            expandedCards.forEach(card => {
                const canvas = card.querySelectorAll('canvas');
                canvas.forEach(cvs => {
                    const chartInstance = Chart.getChart(cvs);
                    if(chartInstance) chartInstance.resize();
                });
            });
        }, 50);
    }

    // 전역 스코프에 API 노출 (모듈 패턴)
    window.App = {
        init,
        toggleDarkMode,
        toggleSettings,
        saveSettings,
        addRecord,
        editRecord, 
        deleteRecord, 
        safeResetData,
        importJSON,
        importCSV,
        exportCSV,
        exportJSON,
        setChartFilter,
        applyCustomDateRange,
        updateMainChart,
        toggleBadges,
        changeCalendarMonth,
        jumpToCalendarDate,
        switchTab,
        toggleChartExpand,
        closeAllExpands,
        renderMedicalNarrativeReport,
        copyMedicalNarrativeReport,
        downloadMedicalNarrativeReport,
        printMedicalNarrativeReport,
        
        enableInlineEdit: function(date) {
            if (!DateUtil.isValidDateString(date)) return;
            captureInlineEditDraftFromDom();

            const currentDraft = AppState.state.inlineEditDraft;
            if (currentDraft && currentDraft.date !== date) {
                const activeInput = document.getElementById(`inline-weight-${currentDraft.date}`);
                if (activeInput) activeInput.focus();
                showToast('편집 중인 기록을 먼저 저장하거나 취소해주세요.');
                return;
            }

            const record = AppState.records.find(r => r.date === date);
            if(!record) return;

            if (!currentDraft) {
                setInlineEditDraft({
                    date,
                    weight: String(record.weight),
                    fat: Object.prototype.hasOwnProperty.call(record, 'fat') ? String(record.fat) : '',
                    sourceWeight: record.weight,
                    sourceFat: Object.prototype.hasOwnProperty.call(record, 'fat') ? record.fat : null
                });
            }

            applyInlineEditDraftToRow({ focusField: 'weight' });
        },

        saveInlineEdit: function(date) {
            if (!DateUtil.isValidDateString(date)) return showToast('잘못된 기록 날짜입니다.');
            captureInlineEditDraftFromDom();
            const draft = AppState.state.inlineEditDraft;
            if (!draft || draft.date !== date) return showToast('저장할 인라인 편집 내용을 찾지 못했습니다.');

            const wInput = document.getElementById(`inline-weight-${date}`);
            const fInput = document.getElementById(`inline-fat-${date}`);

            const weightText = String(wInput?.value ?? draft.weight ?? '').trim();
            const fatText = String(fInput?.value ?? draft.fat ?? '').trim();
            const newWeight = Number(weightText);
            const hasFatInput = fatText !== '';
            const newFat = hasFatInput ? Number(fatText) : null;
            
            if (!weightText || !Number.isFinite(newWeight) || newWeight < CONFIG.LIMITS.MIN_WEIGHT || newWeight > CONFIG.LIMITS.MAX_WEIGHT) {
                return showToast(`유효한 체중을 입력해주세요 (${CONFIG.LIMITS.MIN_WEIGHT}~${CONFIG.LIMITS.MAX_WEIGHT}kg).`);
            }
            if (hasFatInput && (!Number.isFinite(newFat) || newFat < CONFIG.LIMITS.MIN_FAT || newFat > CONFIG.LIMITS.MAX_FAT)) {
                 return showToast(`유효한 체지방률을 입력해주세요 (${CONFIG.LIMITS.MIN_FAT}~${CONFIG.LIMITS.MAX_FAT}%).`);
            }

            const recordIndex = AppState.records.findIndex(r => r.date === date);
            if(recordIndex >= 0) {
                if (!isInlineEditSourceUnchanged(draft, AppState.records[recordIndex])) {
                    clearInlineEditDraft();
                    updateUI();
                    return showToast('원본 기록이 변경되어 오래된 인라인 편집을 저장하지 않았습니다.');
                }

                const nextRecords = cloneDietRecords(AppState.records);
                nextRecords[recordIndex].weight = MathUtil.round(newWeight);
                if(hasFatInput) nextRecords[recordIndex].fat = MathUtil.round(newFat);
                else delete nextRecords[recordIndex].fat; 
                nextRecords[recordIndex] = sanitizeDietRecord(nextRecords[recordIndex]);
                if (!nextRecords[recordIndex]) return showToast('수정된 기록이 유효하지 않습니다.');
                if (!persistDietRecordsImmediate(nextRecords)) return;

                AppState.records = sanitizeDietRecords(nextRecords);
                AppState.state.isDirty = true;
                clearInlineEditDraft();
                updateUI();
                showToast('수정되었습니다.');
            } else {
                clearInlineEditDraft();
                updateUI();
                showToast('원본 기록이 삭제되어 인라인 편집을 저장하지 않았습니다.');
            }
        },

        cancelInlineEdit: function() {
            clearInlineEditDraft();
            updateUI(); 
        }
    };

    window.onload = init;

})();
