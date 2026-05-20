function showToast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.style.cssText =
        'padding:12px 20px;border-radius:10px;font-size:14px;font-weight:500;' +
        'color:#fff;min-width:250px;max-width:400px;box-shadow:0 4px 16px rgba(0,0,0,0.3);' +
        'opacity:0;transform:translateX(40px);transition:all 0.3s ease;cursor:pointer;';

    var colors = {
        success: 'linear-gradient(135deg, #2ecc71, #27ae60)',
        error: 'linear-gradient(135deg, #e74c3c, #c0392b)',
        warning: 'linear-gradient(135deg, #f39c12, #e67e22)',
        info: 'linear-gradient(135deg, #5b6abf, #7c8aff)'
    };
    toast.style.background = colors[type] || colors.info;
    toast.textContent = message;

    toast.onclick = function () {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(40px)';
        setTimeout(function () { toast.remove(); }, 300);
    };

    container.appendChild(toast);

    requestAnimationFrame(function () {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    });

    setTimeout(function () {
        if (toast.parentNode) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(40px)';
            setTimeout(function () { toast.remove(); }, 300);
        }
    }, 4000);
}
