/**
 * CatStudio — estado do diretor de arte (aberto/fechado), separado do
 * componente para a barra de ferramentas poder abri-lo.
 */
import { reactive } from 'vue';

export const directorMode = reactive({ open: false });
