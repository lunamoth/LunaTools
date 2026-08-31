// navigationActions.js

import { state, setState, findFolder, findNote, CONSTANTS } from './state.js';
import { saveSession } from './storage.js';
import {
    searchInput, showConfirm, sortNotes, showToast
} from './components.js';
import { saveCurrentNoteIfChanged, finishPendingRename, toYYYYMMDD } from './itemActions.js';
import { clearSortedNotesCache } from './renderer.js';


let searchDebounceTimer;
let searchRequestVersion = 0;
const debounce = (fn, delay) => { clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(fn, delay); };

// 명시적인 화면 이동/항목 작업이 시작되면 대기 중인 검색이 뒤늦게 새 화면을 덮어쓰지 않도록 무효화합니다.
export const cancelPendingSearchRequest = ({ restoreInput = true } = {}) => {
    searchRequestVersion += 1;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = undefined;
    if (restoreInput && searchInput) searchInput.value = state.searchTerm;
};

// 저장/이름 변경을 기다리는 동안 새 폴더 또는 노트 선택이 들어오면 이전 탐색을 무효화합니다.
// 두 탐색이 별도 상태로 경합하면 서로 다른 폴더와 노트가 한 세션에 섞일 수 있으므로 공유합니다.
let navigationRequestVersion = 0;
const SEARCH_TERM_MAX_LENGTH = 100; // [버그 수정] 검색어 최대 길이 상수 추가

export const confirmNavigation = async () => {
    if (!state.isDirty) {
        return true;
    }
    return await saveCurrentNoteIfChanged();
};

// 저장/이름 변경을 기다리는 사이 현재 목록이 바뀔 수 있으므로,
// 실제로 현재 화면에 속한 항목인지 마지막 순간에 다시 확인합니다.
// 휴지통은 노트와 폴더를 같은 목록에 표시하므로 findNote()만으로 검사하지 않습니다.
const isSelectableItemInCurrentView = (itemId) => {
    if (itemId === null || itemId === undefined) return true;

    const normalizedId = String(itemId);
    if (state.dateFilter) {
        const entry = state.noteMap.get(normalizedId);
        return Boolean(entry?.note && toYYYYMMDD(entry.note.createdAt) === toYYYYMMDD(state.dateFilter));
    }

    const { item: currentFolder } = findFolder(state.activeFolderId);
    return Array.isArray(currentFolder?.notes)
        && currentFolder.notes.some(item => String(item?.id ?? '') === normalizedId);
};

const fallbackToAllNotesForMissingFolder = (missingFolderId) => {
    console.warn('Requested folder no longer exists. Falling back to All Notes:', missingFolderId);

    const allNotes = Array.from(state.noteMap.values()).map(entry => entry.note);
    const rememberedNoteId = state.lastActiveNotePerFolder[CONSTANTS.VIRTUAL_FOLDERS.ALL.id];
    const fallbackNoteId = rememberedNoteId && allNotes.some(note => note.id === rememberedNoteId)
        ? rememberedNoteId
        : sortNotes(allNotes, state.noteSortOrder)[0]?.id ?? null;
    const nextLastActiveNotePerFolder = { ...state.lastActiveNotePerFolder };
    if (fallbackNoteId) {
        nextLastActiveNotePerFolder[CONSTANTS.VIRTUAL_FOLDERS.ALL.id] = fallbackNoteId;
    } else {
        delete nextLastActiveNotePerFolder[CONSTANTS.VIRTUAL_FOLDERS.ALL.id];
    }

    setState({
        activeFolderId: CONSTANTS.VIRTUAL_FOLDERS.ALL.id,
        activeNoteId: fallbackNoteId,
        lastActiveNotePerFolder: nextLastActiveNotePerFolder,
        dateFilter: null,
        preSearchActiveNoteId: null,
        searchTerm: ''
    });
    if (searchInput) searchInput.value = '';
    saveSession();
    showToast('선택한 폴더를 찾을 수 없어 모든 노트 보기로 이동했습니다.', CONSTANTS.TOAST_TYPE.ERROR);
    return false;
};

export const changeActiveNote = async (newNoteId) => {
    const requestVersion = ++navigationRequestVersion;
    const isLatestRequest = () => requestVersion === navigationRequestVersion;
    cancelPendingSearchRequest();

    // [버그 수정] finishPendingRename의 성공 여부를 확인합니다.
    const renameSuccess = await finishPendingRename();
    if (!isLatestRequest()) return false;
    if (!renameSuccess) {
        showToast("이름 변경 저장에 실패하여 노트 이동을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return false; // 이름 변경 실패 시 작업 중단하고 실패를 반환
    }

    // 대상이 이미 사라졌다면 오래된 DOM 이벤트가 세션에 잘못된 ID를 남기지 않게 합니다.
    if (!isSelectableItemInCurrentView(newNoteId)) {
        showToast('선택한 항목이 더 이상 현재 목록에 없어 이동을 취소했습니다.', CONSTANTS.TOAST_TYPE.ERROR);
        return false;
    }

    if (state.activeNoteId === newNoteId) return true;

    const canNavigate = await confirmNavigation();
    if (!isLatestRequest() || !canNavigate) return false;

    // confirmNavigation()의 저장 대기 중 삭제/복원/가져오기 등으로 목록이 교체될 수 있습니다.
    // 대기 전 검증 결과를 신뢰하지 말고 최신 상태에서 한 번 더 확인합니다.
    if (!isSelectableItemInCurrentView(newNoteId)) {
        showToast('선택한 항목이 더 이상 현재 목록에 없어 이동을 취소했습니다.', CONSTANTS.TOAST_TYPE.ERROR);
        return false;
    }

    if (newNoteId && state.activeFolderId) {
        setState({
            lastActiveNotePerFolder: {
                ...state.lastActiveNotePerFolder,
                [state.activeFolderId]: newNoteId
            }
        });
    }
    
    setState({ activeNoteId: newNoteId });
    saveSession();
    return true; // 성공적으로 노트를 변경했음을 반환
};

export const changeActiveFolder = async (newFolderId, options = {}) => {
    const requestVersion = ++navigationRequestVersion;
    const isLatestRequest = () => requestVersion === navigationRequestVersion;
    cancelPendingSearchRequest();

    // [버그 수정] finishPendingRename의 성공 여부를 확인합니다.
    const renameSuccess = await finishPendingRename();
    if (!isLatestRequest()) return false;
    if (!renameSuccess) {
        showToast("이름 변경 저장에 실패하여 폴더 이동을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return false; // 이름 변경 실패 시 작업 중단
    }

    let { item: folder } = findFolder(newFolderId);
    if (!folder) {
        // [MAJOR BUG FIX] 오래된 DOM 이벤트, 손상된 세션, 가져오기 직후 상태 불일치 등으로
        // 존재하지 않는 폴더 ID가 들어오면 잘못된 activeFolderId를 저장하지 않고 안전한 기본 보기로 복귀합니다.
        if (!options.force) {
            const canNavigate = await confirmNavigation();
            if (!isLatestRequest() || !canNavigate) return false;
        }
        if (!isLatestRequest()) return false;
        return fallbackToAllNotesForMissingFolder(newFolderId);
    }

    if (state.activeFolderId === newFolderId && !state.dateFilter) {
        // [MAJOR BUG FIX] 새 폴더 생성 직후 postUpdateState로 이미 활성 폴더가 바뀐 경우에도
        // no-op 반환 전에 세션을 저장해, 즉시 새로고침해도 방금 만든 폴더 선택이 유지되게 합니다.
        saveSession();
        return true;
    }

    if (!options.force) {
        const canNavigate = await confirmNavigation();
        // 저장이 완료되기 전에 더 최신 선택이 들어왔다면 오래된 요청은 상태를 바꾸지 않습니다.
        if (!isLatestRequest() || !canNavigate) return false;
    }
    if (!isLatestRequest()) return false;

    // 저장을 기다리는 동안 대상 폴더가 삭제·복원·가져오기 등으로 교체될 수 있습니다.
    // 이전 객체 참조를 사용하면 사라진 폴더 ID를 다시 활성 상태와 세션에 기록할 수 있으므로 재조회합니다.
    ({ item: folder } = findFolder(newFolderId));
    if (!folder) {
        return fallbackToAllNotesForMissingFolder(newFolderId);
    }
    
    const notesInFolder = Array.isArray(folder.notes) ? folder.notes : [];
    
    let nextActiveNoteId = null;
    const lastActiveNoteId = state.lastActiveNotePerFolder[newFolderId];

    if (lastActiveNoteId && notesInFolder.some(n => n.id === lastActiveNoteId)) {
        nextActiveNoteId = lastActiveNoteId;
    } 
    else if (notesInFolder.length > 0) {
        const isSortable = folder?.isSortable !== false;
        const notesToSelectFrom = isSortable
            ? sortNotes(notesInFolder, state.noteSortOrder)
            : notesInFolder;
        nextActiveNoteId = notesToSelectFrom[0]?.id ?? null;
    }

    setState({
        activeFolderId: newFolderId,
        activeNoteId: nextActiveNoteId,
        dateFilter: null,
        preSearchActiveNoteId: null,
        searchTerm: ''
    });
    
    if (searchInput) searchInput.value = '';
    saveSession();
    return true;
};

const getCurrentViewNotes = () => {
    if (state.dateFilter) {
        const dateStr = toYYYYMMDD(state.dateFilter);
        return Array.from(state.noteMap.values())
            .map(e => e.note)
            .filter(note => toYYYYMMDD(note.createdAt) === dateStr);
    }
    const { item: currentFolder } = findFolder(state.activeFolderId);
    return currentFolder?.notes ?? [];
};

const handleSearch = (searchTerm) => {
    const previousSearchTerm = state.searchTerm;
    const newState = { searchTerm };
    const { item: currentFolder } = findFolder(state.activeFolderId);
    const isSortableView = currentFolder?.isSortable !== false;
    
    if (searchTerm && !previousSearchTerm) {
        newState.preSearchActiveNoteId = state.activeNoteId;
    }
    
    let nextActiveNoteId = null;

    if (searchTerm) {
        const sourceNotes = getCurrentViewNotes();
        const normalizedSearchTerm = searchTerm.toLowerCase();
        
        const filteredNotes = sourceNotes.filter(n =>
            (n.title ?? n.name ?? '').toLowerCase().includes(normalizedSearchTerm) ||
            (n.content ?? '').toLowerCase().includes(normalizedSearchTerm)
        );
        const notesToSelectFrom = isSortableView ? sortNotes(filteredNotes, state.noteSortOrder) : filteredNotes;
        
        if (notesToSelectFrom.length > 0) {
            nextActiveNoteId = notesToSelectFrom[0].id;
        } else {
            nextActiveNoteId = null;
        }

    } else {
        clearSortedNotesCache();
        const notesInCurrentView = getCurrentViewNotes();

        if (state.preSearchActiveNoteId && notesInCurrentView.some(n => n.id === state.preSearchActiveNoteId)) {
            nextActiveNoteId = state.preSearchActiveNoteId;
        } 
        else {
            if (!state.dateFilter) {
                const lastActiveNoteId = state.lastActiveNotePerFolder[state.activeFolderId];
                if (lastActiveNoteId && notesInCurrentView.some(n => n.id === lastActiveNoteId)) {
                    nextActiveNoteId = lastActiveNoteId;
                }
            }
        }
        
        if (nextActiveNoteId === null && notesInCurrentView.length > 0) {
            const notesToSelectFrom = isSortableView ? sortNotes(notesInCurrentView, state.noteSortOrder) : notesInCurrentView;
            nextActiveNoteId = notesToSelectFrom[0]?.id ?? null;
        }

        newState.preSearchActiveNoteId = null;
    }

    newState.activeNoteId = nextActiveNoteId;
    setState(newState);
};

const restoreSearchInput = () => {
    if (searchInput) searchInput.value = state.searchTerm;
};

const applySearchSafely = async (term, requestVersion) => {
    // 이전 검색 저장이 진행되는 동안 새 입력이 들어오면 오래된 요청을 폐기합니다.
    if (requestVersion !== searchRequestVersion) return;

    // 검색 결과는 활성 노트를 바꿀 수 있으므로, 편집 중인 노트가 실제로 저장된 뒤에만 적용합니다.
    if (!(await confirmNavigation())) {
        if (requestVersion === searchRequestVersion) restoreSearchInput();
        return;
    }

    if (requestVersion !== searchRequestVersion) return;
    handleSearch(term);
};

export const handleSearchInput = async (e) => {
    const requestVersion = ++searchRequestVersion;
    const input = e?.target || searchInput;
    let term = String(input?.value ?? '');

    // [버그 수정] 검색어 길이 제한
    if (term.length > SEARCH_TERM_MAX_LENGTH) {
        term = term.substring(0, SEARCH_TERM_MAX_LENGTH);
        if (input) input.value = term;
        showToast(`검색어는 최대 ${SEARCH_TERM_MAX_LENGTH}자까지 입력할 수 있습니다.`, CONSTANTS.TOAST_TYPE.ERROR);
    }

    const renameSuccess = await finishPendingRename();
    if (requestVersion !== searchRequestVersion) return;
    if (!renameSuccess) {
        showToast("이름 변경 저장에 실패하여 검색을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        restoreSearchInput();
        return;
    }

    debounce(() => {
        void applySearchSafely(term, requestVersion);
    }, CONSTANTS.DEBOUNCE_DELAY.SEARCH);
};

export const handleClearSearch = async () => {
    const requestVersion = ++searchRequestVersion;
    clearTimeout(searchDebounceTimer);

    const renameSuccess = await finishPendingRename();
    if (requestVersion !== searchRequestVersion) return;
    if (!renameSuccess) {
        showToast("이름 변경 저장에 실패하여 검색 지우기를 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        restoreSearchInput();
        return;
    }

    if (!(await confirmNavigation())) {
        if (requestVersion === searchRequestVersion) restoreSearchInput();
        return;
    }
    if (requestVersion !== searchRequestVersion || !searchInput) return;
    if (searchInput.value === '' && state.searchTerm === '') return;

    searchInput.value = '';
    handleSearch('');
    searchInput.focus();
};

export const handleSortChange = async (e) => {
    const renameSuccess = await finishPendingRename();
    if (!renameSuccess) {
        e.target.value = state.noteSortOrder;
        showToast("이름 변경 저장에 실패하여 정렬 변경을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }

    if (!(await confirmNavigation())) {
        e.target.value = state.noteSortOrder;
        return;
    }
    
    setState({ noteSortOrder: e.target.value });
    saveSession();
};
