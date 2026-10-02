// storageLock.js

// [설계 전제 / 수정 금지선]
// 이 앱은 여러 탭에서 동일한 문서를 동시에 편집하는 것 자체를 지원하지 않고, 가정하지도 않습니다.
// 따라서 버그 수정 과정에서 cross-tab 동기화, 문서 컨텍스트 간 병합,
// localStorage lease lock, IndexedDB lock, BroadcastChannel, storage event 기반 조정 로직을 추가하지 않습니다.
// 이 모듈의 폴백은 현재 문서 컨텍스트 안의 비동기 저장 순서 보장(local Promise queue)까지만 담당합니다.

const APP_STATE_LOCK_NAME = 'mothnote-app-state-write-v1';
let localQueue = Promise.resolve();

const runWithLocalQueue = async (task) => {
    // [MAJOR BUG FIX] Web Locks를 사용할 수 없거나 실패한 환경에서도 저장 큐가 멈추지 않도록
    // 이전 게이트의 예외를 흡수하고, 현재 게이트는 task 성공/실패와 무관하게 반드시 해제합니다.
    const previous = localQueue.catch(error => {
        console.warn('Previous local storage lock queue gate failed. Continuing with the next queued task.', error);
    });
    let release;
    localQueue = new Promise(resolve => { release = resolve; });

    await previous;
    try {
        return await task();
    } finally {
        if (typeof release === 'function') release();
    }
};

export const withAppStateWriteLock = async (task) => {
    if (typeof task !== 'function') {
        throw new TypeError('withAppStateWriteLock에는 함수가 필요합니다.');
    }

    // [CRITICAL BUG FIX] Web Locks 성공 경로와 폴백 경로가 서로 다른 직렬화 경계를
    // 사용하면, 한 요청만 일시적으로 실패했을 때 폴백 작업이 이미 실행 중인 Web Lock
    // 작업과 겹칠 수 있습니다. 모든 쓰기를 먼저 현재 문서의 로컬 큐에 넣은 뒤,
    // 각 큐 작업 안에서 Web Locks를 시도하여 두 경로 사이의 경쟁 조건도 차단합니다.
    return runWithLocalQueue(async () => {
        // Web Locks API를 사용할 수 있으면 단일 활성 문서의 저장 경계를 직렬화하는 데 활용합니다.
        // 이 사용은 멀티탭 동시 편집 지원 계약이 아니며, API가 없거나 실패하면
        // 이미 확보한 현재 문서의 Promise queue 경계 안에서 작업을 실행합니다.
        if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
            let taskStarted = false;
            try {
                return await navigator.locks.request(APP_STATE_LOCK_NAME, { mode: 'exclusive' }, async () => {
                    taskStarted = true;
                    return await task();
                });
            } catch (error) {
                if (taskStarted) {
                    // task 내부 오류는 정상적으로 호출자에게 전달해야 하며, 폴백에서 다시 실행하면
                    // 저장/가져오기 같은 부작용 작업이 중복 실행될 수 있습니다.
                    throw error;
                }
                // 일부 확장/브라우저 컨텍스트에서 Web Locks 요청 자체가 실패할 수 있습니다.
                // 이 경우에도 현재 문서의 로컬 큐를 유지한 채 저장 작업을 한 번만 실행합니다.
                console.warn('Web Locks request failed before the task started. Continuing inside the local storage write queue.', error);
            }
        }

        return await task();
    });
};
