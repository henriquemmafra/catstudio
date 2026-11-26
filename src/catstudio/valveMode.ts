/**
 * CatStudio — estado do modo Valvas (aberto/fechado), separado do componente
 * para a barra de ferramentas poder abri-lo.
 */
import { reactive } from 'vue';

export const valveMode = reactive({ open: false });
